import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormError } from '@/components/FormError';
import { Skeleton } from '@/components/Skeleton';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  ArtifactStore,
  ARTIFACT_CONTENT_MAX,
  highlightCodeLine,
  prepareArtifactExport,
  shareArtifactFile,
  type ArtifactDetail,
  type CodeTokenKind,
} from '@/lib/artifacts';
import {
  ARTIFACT_ERROR_BRIDGE_JS,
  buildPreviewDocument,
} from '@/lib/artifacts/preview';
import { formatDateTime } from '@/lib/dates';
import { fonts, radius, spacing } from '@/theme';

type ViewerTab = 'preview' | 'code';

type WebViewComponent = typeof import('react-native-webview').WebView;

/** Code is windowed in blocks so very large artifacts stay cheap to render. */
const CODE_CHUNK_LINES = 40;

function isInternalUrl(url: string): boolean {
  return url === 'about:blank' || url.toLowerCase().startsWith('data:');
}

function isExternalLink(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

const BRIDGE_LABELS: Record<string, string> = {
  error: 'Error',
  console_error: 'Console error',
  console_warn: 'Console warning',
};

/** Accepts only the small, content-free messages sent by the error bridge. */
function parseBridgeMessage(data: string): string | null {
  try {
    const parsed = JSON.parse(data) as {
      source?: unknown;
      type?: unknown;
      message?: unknown;
    };

    if (parsed.source !== 'orbit-artifact') {
      return null;
    }

    if (typeof parsed.type !== 'string' || !BRIDGE_LABELS[parsed.type]) {
      return null;
    }

    if (typeof parsed.message !== 'string' || !parsed.message) {
      return null;
    }

    return `${BRIDGE_LABELS[parsed.type]}: ${parsed.message.slice(0, 500)}`;
  } catch {
    return null;
  }
}

function codeTokenColor(colors: AppTheme['colors'], kind: CodeTokenKind): string {
  switch (kind) {
    case 'keyword':
      return colors.accent;
    case 'string':
      return colors.success;
    case 'comment':
      return colors.textFaint;
    case 'number':
      return colors.warning;
    case 'type':
      return colors.danger;
    case 'plain':
    default:
      return colors.text;
  }
}

/** Artifact viewer reached from an assistant message's artifact card. */
export default function ArtifactScreen() {
  const { colors, isLight } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ViewerTab>('preview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [WebViewView, setWebViewView] = useState<WebViewComponent | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const store = useMemo(() => new ArtifactStore(db), [db]);
  const isOldVersion =
    detail !== null && version !== null && version !== detail.currentVersion;

  // The native WebView module is loaded only when a preview is actually shown.
  // Hidden tabs can be mounted at startup, so importing it eagerly would make
  // the first WebView construction part of the app's launch path.
  useEffect(() => {
    if (!detail || tab !== 'preview' || WebViewView) {
      return;
    }

    let active = true;

    void import('react-native-webview').then((module) => {
      if (active) {
        setWebViewView(() => module.WebView);
      }
    });

    return () => {
      active = false;
    };
  }, [detail, tab, WebViewView]);

  const load = useCallback(async () => {
    if (!user || !id) {
      setDetail(null);
      setError('Artifact not found.');
      setRuntimeError(null);
      setFullscreen(false);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const found = await store.get(user.id, id);

      if (!found) {
        setDetail(null);
        setError('This artifact no longer exists.');
        setRuntimeError(null);
        setFullscreen(false);
        return;
      }

      setDetail(found);
      setVersion(found.currentVersion);
      setContent(found.content);
      setError(null);
      setRuntimeError(null);
    } catch (loadError) {
      console.warn('Could not load artifact.', loadError);
      setError('Could not load this artifact.');
    } finally {
      setLoading(false);
    }
  }, [id, store, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openVersion = useCallback(
    async (next: number) => {
      if (!user || !id || next === version) {
        setVersionsOpen(false);
        return;
      }

      try {
        const found = await store.getVersion(user.id, id, next);

        if (found) {
          setVersion(next);
          setContent(found.content);
          setError(null);
          setRuntimeError(null);
        }
      } catch (versionError) {
        console.warn('Could not load artifact version.', versionError);
        setError('Could not load that version.');
      } finally {
        setVersionsOpen(false);
      }
    },
    [id, store, user, version]
  );

  const restoreVersion = useCallback(async () => {
    if (!user || !id || !detail || version === null || version === detail.currentVersion) {
      return;
    }

    try {
      setBusy(true);
      await store.restoreVersion(user.id, id, version);
      setVersionsOpen(false);
      await load();
    } catch (restoreError) {
      Alert.alert(
        'Could not restore version',
        restoreError instanceof Error ? restoreError.message : 'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }, [detail, id, load, store, user, version]);

  const copyContent = useCallback(async () => {
    setMenuOpen(false);

    try {
      await Clipboard.setStringAsync(content);
      Alert.alert('Copied', 'Artifact content copied to the clipboard.');
    } catch (copyError) {
      console.warn('Could not copy artifact content.', copyError);
      setError('Could not copy the artifact content.');
    }
  }, [content]);

  const exportArtifact = useCallback(async () => {
    setMenuOpen(false);

    if (!detail) {
      return;
    }

    try {
      setBusy(true);
      const file = await prepareArtifactExport({
        title: detail.title,
        type: detail.type,
        language: detail.language,
        content,
      });
      await shareArtifactFile(file);
    } catch (exportError) {
      console.warn('Could not export artifact.', exportError);
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Could not export this artifact as a file.'
      );
    } finally {
      setBusy(false);
    }
  }, [content, detail]);

  const confirmDelete = useCallback(() => {
    if (!user || !id || !detail) {
      return;
    }

    setMenuOpen(false);
    Alert.alert(
      'Delete artifact?',
      `“${detail.title}” and its version history will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setBusy(true);
                await store.remove(user.id, id);
                router.back();
              } catch (deleteError) {
                console.warn('Could not delete artifact.', deleteError);
                setError('Could not delete this artifact.');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ]
    );
  }, [detail, id, router, store, user]);

  const openChatWithPrompt = useCallback(
    (prompt: string) => {
      if (!detail) {
        return;
      }

      const queryParams: Record<string, string> = {
        prompt,
        t: String(Date.now()),
      };

      if (detail.conversationId !== null) {
        queryParams.c = String(detail.conversationId);
      } else {
        queryParams.n = '1';
      }

      const query = Object.entries(queryParams)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');

      router.navigate(`/chat?${query}` as Href);
    },
    [detail, router]
  );

  const askOrbit = useCallback(() => {
    if (!detail) {
      return;
    }

    openChatWithPrompt(
      `Update the current version of the artifact “${detail.title}” (id ${detail.id}): `
    );
  }, [detail, openChatWithPrompt]);

  const fixRuntimeError = useCallback(() => {
    if (!detail || !runtimeError) {
      return;
    }

    openChatWithPrompt(
      `Fix a runtime error in the HTML artifact “${detail.title}” (id ${detail.id}). ` +
        `The preview reported: ${runtimeError}. Read the artifact first, then make the smallest exact edit that fixes it. ` +
        'Do not paste the artifact content into chat.'
    );
  }, [detail, openChatWithPrompt, runtimeError]);

  const openEditor = useCallback(() => {
    setMenuOpen(false);

    if (isOldVersion) {
      Alert.alert(
        'Restore a version to edit',
        'You can edit the current version. Restore this version first if you want to use it as the starting point.'
      );
      return;
    }

    setEditDraft(content);
    setEditError(null);
    setEditOpen(true);
  }, [content, isOldVersion]);

  const saveEdit = useCallback(async () => {
    if (!user || !id || !detail || isOldVersion) {
      return;
    }

    if (!editDraft.trim()) {
      setEditError('Content cannot be empty.');
      return;
    }

    if (editDraft.length > ARTIFACT_CONTENT_MAX) {
      setEditError(`The content is over the ${ARTIFACT_CONTENT_MAX.toLocaleString()} character limit.`);
      return;
    }

    try {
      setBusy(true);
      setEditError(null);
      await store.addVersion(user.id, id, editDraft, 'Edited manually');
      setEditOpen(false);
      setPreviewNonce((current) => current + 1);
      await load();
    } catch (saveError) {
      setEditError(
        saveError instanceof Error ? saveError.message : 'Could not save this version.'
      );
    } finally {
      setBusy(false);
    }
  }, [detail, editDraft, id, isOldVersion, load, store, user]);

  const reloadPreview = useCallback(() => {
    setRuntimeError(null);
    setPreviewNonce((current) => current + 1);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((current) => !current);
  }, []);

  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const message = parseBridgeMessage(event.nativeEvent.data);

    if (message) {
      setRuntimeError((current) => (current === message ? current : message));
    }
  }, []);

  const handleShouldStart = useCallback((event: { url: string }) => {
    const url = event.url;

    if (isInternalUrl(url)) {
      return true;
    }

    if (isExternalLink(url)) {
      Alert.alert('Open this link?', url, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open',
          onPress: () => {
            void Linking.openURL(url).catch(() => {
              // The operating system refused the link; nothing else to do.
            });
          },
        },
      ]);
    }

    return false;
  }, []);

  const previewHtml = useMemo(
    () =>
      detail
        ? buildPreviewDocument({ type: detail.type, content }, { isLight, colors })
        : '',
    [colors, content, detail, isLight]
  );

  const codeChunks = useMemo(() => {
    const lines = content.split('\n');
    const chunks: string[] = [];

    for (let index = 0; index < lines.length; index += CODE_CHUNK_LINES) {
      chunks.push(lines.slice(index, index + CODE_CHUNK_LINES).join('\n'));
    }

    return chunks.length > 0 ? chunks : [''];
  }, [content]);

  const previewView =
    WebViewView && detail ? (
      <WebViewView
        key={`${detail.id}-${version}-${previewNonce}`}
        testID="artifact-preview"
        source={{ html: previewHtml, baseUrl: 'about:blank' }}
        style={[
          fullscreen ? styles.fullscreenPreview : styles.preview,
          { backgroundColor: colors.surface },
        ]}
        // react-native-webview auto-opens URLs that fail the whitelist before
        // onShouldStartLoadWithRequest runs. Let link schemes reach the
        // callback so the user gets a confirmation instead of a silent launch.
        originWhitelist={['about:blank', 'data:*', 'http://*', 'https://*', 'mailto:*']}
        javaScriptEnabled={detail.type === 'html'}
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        saveFormDataDisabled
        thirdPartyCookiesEnabled={false}
        mixedContentMode="never"
        geolocationEnabled={false}
        mediaCapturePermissionGrantType="deny"
        mediaPlaybackRequiresUserAction
        allowsFullscreenVideo={false}
        allowsInlineMediaPlayback={false}
        allowsPictureInPictureMediaPlayback={false}
        cacheEnabled={false}
        injectedJavaScriptBeforeContentLoaded={
          detail.type === 'html' ? ARTIFACT_ERROR_BRIDGE_JS : undefined
        }
        onMessage={detail.type === 'html' ? handleWebViewMessage : undefined}
        onShouldStartLoadWithRequest={handleShouldStart}
        showsHorizontalScrollIndicator={false}
      />
    ) : (
      <Skeleton height={220} radius={radius.md} />
    );

  if (fullscreen && !loading && detail && !error && tab === 'preview') {
    return (
      <View style={styles.fullscreenRoot}>
        {previewView}
        <View
          style={[
            styles.fullscreenControls,
            { top: insets.top + spacing.sm, right: spacing.sm },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload preview"
            hitSlop={8}
            onPress={reloadPreview}
            style={styles.fullscreenButton}
          >
            <Ionicons name="refresh-outline" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit fullscreen preview"
            hitSlop={8}
            onPress={toggleFullscreen}
            style={styles.fullscreenButton}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
        </View>
        {runtimeError ? (
          <View style={styles.fullscreenError}>
            <Text numberOfLines={2} style={styles.fullscreenErrorText}>
              {runtimeError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fix this preview error with Orbit"
              hitSlop={6}
              onPress={fixRuntimeError}
            >
              <Text style={styles.fixLink}>Fix with Orbit</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>

        <View style={styles.headerText}>
          {loading ? (
            <Skeleton width={160} height={22} />
          ) : (
            <Text numberOfLines={1} style={styles.title}>
              {detail?.title ?? 'Artifact'}
            </Text>
          )}
        </View>

        {!loading && detail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Version ${version ?? detail.currentVersion}, show history`}
            onPress={() => setVersionsOpen(true)}
            style={styles.versionChip}
          >
            <Text style={styles.versionChipText}>v{version ?? detail.currentVersion}</Text>
          </Pressable>
        ) : null}

        {!loading && detail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            onPress={() => setMenuOpen(true)}
            style={styles.iconButton}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.skeletonBody}>
          <Skeleton height={44} radius={radius.md} />
          <Skeleton height={18} />
          <Skeleton width="85%" height={18} />
          <Skeleton width="65%" height={18} />
          <Skeleton height={220} radius={radius.md} />
        </View>
      ) : error || !detail ? (
        <View style={styles.centered}>
          <FormError message={error ?? 'Artifact not found.'} />
        </View>
      ) : (
        <>
          {isOldVersion ? (
            <View style={styles.oldVersionBar}>
              <Text style={styles.oldVersionText}>Viewing v{version} · </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restore version ${version}`}
                disabled={busy}
                hitSlop={8}
                onPress={() => void restoreVersion()}
              >
                <Text style={styles.restoreLink}>Restore</Text>
              </Pressable>
            </View>
          ) : null}

          {runtimeError && tab === 'preview' ? (
            <View style={styles.runtimeErrorBanner}>
              <Ionicons
                name="warning-outline"
                size={18}
                color={colors.danger}
                style={styles.runtimeErrorIcon}
              />
              <View style={styles.runtimeErrorBody}>
                <Text style={styles.runtimeErrorTitle}>Preview error</Text>
                <Text numberOfLines={3} style={styles.runtimeErrorDetail}>
                  {runtimeError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fix this preview error with Orbit"
                  hitSlop={6}
                  onPress={fixRuntimeError}
                >
                  <Text style={styles.fixLink}>Fix with Orbit</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss preview error"
                hitSlop={8}
                onPress={() => setRuntimeError(null)}
                style={styles.dismissButton}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}

          <View accessibilityRole="tablist" style={styles.segmented}>
            {(['preview', 'code'] as const).map((option) => {
              const active = tab === option;

              return (
                <Pressable
                  key={option}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  onPress={() => setTab(option)}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {option === 'preview' ? 'Preview' : 'Code'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {tab === 'preview' ? (
            <>
              <View style={styles.previewToolbar}>
                <Text style={styles.previewToolbarTitle}>Preview</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit artifact content"
                  hitSlop={8}
                  onPress={openEditor}
                  style={styles.previewTool}
                >
                  <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reload preview"
                  hitSlop={8}
                  onPress={reloadPreview}
                  style={styles.previewTool}
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View preview fullscreen"
                  hitSlop={8}
                  onPress={toggleFullscreen}
                  style={styles.previewTool}
                >
                  <Ionicons name="expand-outline" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
              {previewView}
            </>
          ) : (
            <FlatList
              data={codeChunks}
              keyExtractor={(_item, index) => String(index)}
              renderItem={({ item }) => (
                <Text selectable style={styles.codeText}>
                  {item.split('\n').map((line, lineIndex) => (
                    <Text key={lineIndex}>
                      {highlightCodeLine(line, detail.language).map((token, tokenIndex) => (
                        <Text
                          key={tokenIndex}
                          style={{ color: codeTokenColor(colors, token.kind) }}
                        >
                          {token.text}
                        </Text>
                      ))}
                      {'\n'}
                    </Text>
                  ))}
                </Text>
              )}
              style={styles.codeList}
              contentContainerStyle={styles.codeContent}
              showsVerticalScrollIndicator
            />
          )}

          <View style={[styles.askBar, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask Orbit to change this artifact"
              onPress={askOrbit}
              style={styles.askButton}
            >
              <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
              <Text style={styles.askText}>Ask Orbit to change this</Text>
            </Pressable>
          </View>
        </>
      )}

      <Modal
        transparent
        visible={menuOpen}
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close options"
            onPress={() => setMenuOpen(false)}
            style={styles.scrim}
          />
          <View style={[styles.menu, { top: insets.top + 64, right: spacing.sm }]}>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Edit artifact content"
              onPress={openEditor}
              style={styles.menuItem}
            >
              <Ionicons name="create-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Edit</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Copy artifact content"
              onPress={() => void copyContent()}
              style={styles.menuItem}
            >
              <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Copy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Export artifact as a file"
              disabled={busy}
              onPress={() => void exportArtifact()}
              style={styles.menuItem}
            >
              <Ionicons name="download-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Export file</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Show version history"
              onPress={() => {
                setMenuOpen(false);
                setVersionsOpen(true);
              }}
              style={styles.menuItem}
            >
              <Ionicons name="time-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Versions</Text>
            </Pressable>
            <View style={styles.menuDivider} />
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Delete artifact"
              onPress={confirmDelete}
              style={styles.menuItem}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={versionsOpen}
        animationType="slide"
        onRequestClose={() => setVersionsOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close version history"
            onPress={() => setVersionsOpen(false)}
            style={styles.scrim}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                Version history
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close version history"
                onPress={() => setVersionsOpen(false)}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {isOldVersion ? (
              <View style={styles.restoreBanner}>
                <Text style={styles.restoreBannerText}>Viewing v{version} · </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Restore version ${version}`}
                  disabled={busy}
                  hitSlop={8}
                  onPress={() => void restoreVersion()}
                >
                  <Text style={styles.restoreLink}>Restore</Text>
                </Pressable>
              </View>
            ) : null}

            <FlatList
              data={detail?.versions ?? []}
              keyExtractor={(item) => String(item.id)}
              style={styles.versionList}
              renderItem={({ item }) => {
                const active = item.version === version;

                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`View version ${item.version}, ${formatDateTime(item.createdAt)}`}
                    onPress={() => void openVersion(item.version)}
                    style={[styles.versionRow, active && styles.versionRowActive]}
                  >
                    <View style={styles.versionRowText}>
                      <Text style={styles.versionLabel}>
                        v{item.version}
                        {detail && item.version === detail.currentVersion ? ' · Current' : ''}
                      </Text>
                      <Text style={styles.versionMeta}>{formatDateTime(item.createdAt)}</Text>
                      <Text numberOfLines={2} style={styles.versionSummary}>
                        {item.summary ?? (item.version === 1 ? 'Initial version' : 'Updated')}
                      </Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      <Modal
        transparent
        visible={editOpen}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) {
            setEditOpen(false);
          }
        }}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close editor"
            disabled={busy}
            onPress={() => setEditOpen(false)}
            style={styles.scrim}
          />
          <View style={[styles.editorSheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                Edit artifact
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close editor"
                disabled={busy}
                onPress={() => setEditOpen(false)}
                style={styles.iconButton}
              >
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.editorHint}>
              Saving creates a new version. Ask Orbit when you want help with larger changes.
            </Text>
            <TextInput
              accessibilityLabel="Artifact content"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={ARTIFACT_CONTENT_MAX}
              multiline
              onChangeText={setEditDraft}
              style={styles.editorInput}
              textAlignVertical="top"
              value={editDraft}
            />
            {editError ? <FormError message={editError} /> : null}
            <View style={styles.editorFooter}>
              <Text style={styles.editorCount}>
                {editDraft.length.toLocaleString()} / {ARTIFACT_CONTENT_MAX.toLocaleString()}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
                disabled={busy}
                onPress={() => setEditOpen(false)}
                style={styles.editorCancel}
              >
                <Text style={styles.editorCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save artifact version"
                disabled={busy || !editDraft.trim()}
                onPress={() => void saveEdit()}
                style={styles.editorSave}
              >
                <Text style={styles.editorSaveText}>{busy ? 'Saving…' : 'Save version'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 56,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    iconButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
      justifyContent: 'center',
    },
    title: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 20,
      fontWeight: '600',
    },
    versionChip: {
      minHeight: 48,
      minWidth: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.sm,
    },
    versionChipText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    skeletonBody: {
      gap: spacing.md,
      padding: spacing.md,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    oldVersionBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      backgroundColor: colors.warningSoft,
    },
    oldVersionText: {
      color: colors.text,
      fontSize: 13,
    },
    restoreLink: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    runtimeErrorBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.dangerSoft,
    },
    runtimeErrorIcon: {
      marginTop: 2,
    },
    runtimeErrorBody: {
      flex: 1,
      gap: 2,
    },
    runtimeErrorTitle: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '700',
    },
    runtimeErrorDetail: {
      color: colors.text,
      fontSize: 13,
    },
    fixLink: {
      alignSelf: 'flex-start',
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
      paddingVertical: 4,
    },
    dismissButton: {
      minWidth: 32,
      minHeight: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmented: {
      flexDirection: 'row',
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentActive: {
      backgroundColor: colors.accentSoft,
    },
    segmentText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.accent,
    },
    preview: {
      flex: 1,
    },
    fullscreenRoot: {
      flex: 1,
      backgroundColor: colors.background,
    },
    fullscreenPreview: {
      flex: 1,
    },
    fullscreenControls: {
      position: 'absolute',
      flexDirection: 'row',
      gap: spacing.xs,
    },
    fullscreenButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    fullscreenError: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.md,
      gap: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    fullscreenErrorText: {
      color: colors.text,
      fontSize: 13,
    },
    previewToolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    previewToolbarTitle: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    previewTool: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    codeList: {
      flex: 1,
    },
    codeContent: {
      padding: spacing.md,
      backgroundColor: colors.surface,
    },
    codeText: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: 13,
      lineHeight: 20,
    },
    askBar: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    askButton: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
    },
    askText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '700',
    },
    modalRoot: {
      flex: 1,
    },
    scrim: {
      flex: 1,
      backgroundColor: colors.background,
      opacity: 0.65,
    },
    menu: {
      position: 'absolute',
      minWidth: 210,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingVertical: spacing.xs,
    },
    menuItem: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    menuItemText: {
      color: colors.text,
      fontSize: 15,
    },
    menuItemDanger: {
      color: colors.danger,
    },
    menuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.xs,
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '80%',
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
    },
    sheetTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 22,
      fontWeight: '600',
    },
    restoreBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      backgroundColor: colors.accentSoft,
    },
    restoreBannerText: {
      color: colors.text,
      fontSize: 13,
    },
    versionList: {
      maxHeight: 420,
    },
    versionRow: {
      minHeight: 68,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    versionRowActive: {
      backgroundColor: colors.surfaceAlt,
    },
    versionRowText: {
      flex: 1,
      gap: 2,
    },
    versionLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    versionMeta: {
      color: colors.textMuted,
      fontSize: 12,
    },
    versionSummary: {
      color: colors.textFaint,
      fontSize: 12,
    },
    editorSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    editorHint: {
      color: colors.textMuted,
      fontSize: 13,
    },
    editorInput: {
      flex: 1,
      minHeight: 180,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: 13,
      lineHeight: 20,
    },
    editorFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    editorCount: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 12,
    },
    editorCancel: {
      minHeight: 44,
      paddingHorizontal: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    editorCancelText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    editorSave: {
      minHeight: 44,
      paddingHorizontal: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
    },
    editorSaveText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '700',
    },
  });
