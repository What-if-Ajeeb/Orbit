import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { ArtifactStore, artifactTypeLabel, type ArtifactDetail } from '@/lib/artifacts';
import { buildPreviewDocument } from '@/lib/artifacts/preview';
import { fonts, radius, spacing } from '@/theme';

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

  const store = useMemo(() => new ArtifactStore(db), [db]);

  const load = useCallback(async () => {
    if (!user || !id) {
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
        return;
      }

      try {
        const found = await store.getVersion(user.id, id, next);

        if (found) {
          setVersion(next);
          setContent(found.content);
        }
      } catch (versionError) {
        console.warn('Could not load artifact version.', versionError);
      }
    },
    [id, store, user, version]
  );

  const restoreVersion = useCallback(async () => {
    if (!user || !id || !detail || version === null || version === detail.currentVersion) {
      return;
    }

    try {
      await store.restoreVersion(user.id, id, version);
      await load();
    } catch (restoreError) {
      Alert.alert(
        'Could not restore version',
        restoreError instanceof Error ? restoreError.message : 'Please try again.'
      );
    }
  }, [detail, id, load, store, user, version]);

  const copyContent = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(content);
      Alert.alert('Copied', 'Artifact content copied to the clipboard.');
    } catch (copyError) {
      console.warn('Could not copy artifact content.', copyError);
    }
  }, [content]);

  const previewHtml = useMemo(
    () =>
      detail
        ? buildPreviewDocument({ type: detail.type, content }, { isLight, colors })
        : '',
    [colors, content, detail, isLight]
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.title}>
            {detail?.title ?? 'Artifact'}
          </Text>
          {detail ? (
            <Text style={styles.subtitle}>
              {artifactTypeLabel(detail.type)} · v{version ?? detail.currentVersion}
              {detail.language ? ` · ${detail.language}` : ''}
            </Text>
          ) : null}
        </View>
        {detail ? (
          <Pressable onPress={() => void copyContent()} hitSlop={12} style={styles.iconButton}>
            <Ionicons name="copy-outline" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error || !detail ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Artifact not found.'}</Text>
        </View>
      ) : (
        <>
          <ScrollView
            horizontal
            style={styles.versions}
            contentContainerStyle={styles.versionsContent}
            showsHorizontalScrollIndicator={false}
          >
            {detail.versions.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => void openVersion(item.version)}
                style={[styles.chip, item.version === version && styles.chipActive]}
              >
                <Text style={[styles.chipText, item.version === version && styles.chipTextActive]}>
                  v{item.version}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <WebView
            source={{ html: previewHtml }}
            style={[styles.preview, { backgroundColor: colors.surface }]}
            originWhitelist={['about:blank', 'data:']}
            javaScriptEnabled={detail.type === 'html'}
            showsHorizontalScrollIndicator={false}
          />

          {version !== detail.currentVersion ? (
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
              <Pressable style={styles.restoreButton} onPress={() => void restoreVersion()}>
                <Text style={styles.restoreText}>Restore v{version} as new version</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
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
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: spacing.xs,
    },
    iconButton: {
      padding: spacing.xs,
    },
    headerText: {
      flex: 1,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 20,
      fontWeight: '600',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    errorText: {
      color: colors.textMuted,
      fontSize: 15,
      textAlign: 'center',
    },
    versions: {
      maxHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    versionsContent: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chip: {
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    chipActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    chipTextActive: {
      color: colors.accent,
      fontWeight: '600',
    },
    preview: {
      flex: 1,
    },
    footer: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    restoreButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
    },
    restoreText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
  });
