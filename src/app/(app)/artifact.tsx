import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { FormError } from '@/components/FormError';
import { Skeleton } from '@/components/Skeleton';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { ArtifactStore, type ArtifactDetail } from '@/lib/artifacts';
import { buildPreviewDocument } from '@/lib/artifacts/preview';
import { formatDateTime } from '@/lib/dates';
import { fonts, radius, spacing } from '@/theme';

type ViewerTab = 'preview' | 'code';

/** Code is windowed in blocks so very large artifacts stay cheap to render. */
const CODE_CHUNK_LINES = 40;

function isInternalUrl(url: string): boolean {
  return url === 'about:blank' || url.toLowerCase().startsWith('data:');
}

function isExternalLink(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

/** Read-only artifact viewer reached from an assistant message's artifact card. */
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

  const store = useMemo(() => new ArtifactStore(db), [db]);

  const load = useCallback(async () => {
    if (!user || !id) {
      setDetail(null);
      setError('Artifact not found.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const found = await store.get(user.id, id);

      if (!found) {
        setDetail(null);
        setError('This artifact no longer exists.');
        return;
      }

      setDetail(found);
      setVersion(found.currentVersion);
      setContent(found.content);
      setError(null);
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

  const shareContent = useCallback(async () => {
    setMenuOpen(false);

    try {
      await Share.share({ message: content, title: detail?.title ?? 'Artifact' });
    } catch (shareError) {
      console.warn('Could not share artifact.', shareError);
      setError('Could not share this artifact.');
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

  const askOrbit = useCallback(() => {
    if (!detail) {
      return;
    }

    const queryParams: Record<string, string> = {
      prompt: `Update the artifact “${detail.title}” (id ${detail.id}): `,
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

    router.push(`/chat?${query}` as Href);
  }, [detail, router]);

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

  const isOldVersion =
    detail !== null && version !== null && version !== detail.currentVersion;

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
            <WebView
              source={{ html: previewHtml, baseUrl: 'about:blank' }}
              style={[styles.preview, { backgroundColor: colors.surface }]}
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
              onShouldStartLoadWithRequest={handleShouldStart}
              showsHorizontalScrollIndicator={false}
            />
          ) : (
            <FlatList
              data={codeChunks}
              keyExtractor={(_item, index) => String(index)}
              renderItem={({ item }) => (
                <Text selectable style={styles.codeText}>
                  {item}
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
              accessibilityLabel="Copy artifact content"
              onPress={() => void copyContent()}
              style={styles.menuItem}
            >
              <Ionicons name="copy-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Copy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Share artifact content"
              onPress={() => void shareContent()}
              style={styles.menuItem}
            >
              <Ionicons name="share-outline" size={18} color={colors.textMuted} />
              <Text style={styles.menuItemText}>Share</Text>
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
  });
