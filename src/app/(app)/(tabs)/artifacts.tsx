import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  ArtifactStore,
  artifactTypeLabel,
  type ArtifactFilter,
  type ArtifactSummary,
  type ArtifactType,
} from '@/lib/artifacts';
import { formatDateTime } from '@/lib/dates';
import { fonts, radius, spacing } from '@/theme';

const FILTERS: { id: ArtifactFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'markdown', label: 'Documents' },
  { id: 'html', label: 'Pages' },
  { id: 'svg', label: 'Graphics' },
  { id: 'code', label: 'Code' },
];

const TYPE_ICONS: Record<ArtifactType, keyof typeof Ionicons.glyphMap> = {
  markdown: 'document-text-outline',
  html: 'globe-outline',
  svg: 'image-outline',
  code: 'code-slash-outline',
};

/** Library of artifacts the agent has created for this user. */
export default function ArtifactsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const store = useMemo(() => new ArtifactStore(db), [db]);

  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoaded(true);
      return;
    }

    try {
      const rows = await store.list(user.id);
      setItems(rows);
      setError(null);
    } catch (loadError) {
      console.warn('Could not load artifacts.', loadError);
      setError('Could not load your artifacts.');
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
  }, [store, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return items.filter((item) => {
      if (filter !== 'all' && item.type !== filter) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return (
        item.title.toLowerCase().includes(needle) ||
        artifactTypeLabel(item.type).toLowerCase().includes(needle)
      );
    });
  }, [filter, items, query]);

  const confirmDelete = useCallback(
    (item: ArtifactSummary) => {
      if (!user) {
        return;
      }

      Alert.alert(
        'Delete artifact?',
        `“${item.title}” and its version history will be permanently deleted.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await store.remove(user.id, item.id);
                  setItems((previous) => previous.filter((entry) => entry.id !== item.id));
                } catch (deleteError) {
                  console.warn('Could not delete artifact.', deleteError);
                  setError('Could not delete this artifact.');
                }
              })();
            },
          },
        ]
      );
    },
    [store, user]
  );

  const openArtifact = useCallback(
    (id: string) => {
      router.push({ pathname: '/artifact', params: { id } });
    },
    [router]
  );

  const openAgent = useCallback(() => {
    router.push(`/chat?n=1&t=${Date.now()}` as Href);
  }, [router]);

  const isFiltered = query.trim().length > 0 || filter !== 'all';

  return (
    <View style={styles.root}>
      <FlatList
        data={visibleItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}, ${artifactTypeLabel(item.type)} version ${item.currentVersion}`}
            accessibilityHint="Long press to delete."
            onPress={() => openArtifact(item.id)}
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={TYPE_ICONS[item.type]} size={20} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.title}
              </Text>
              <Text style={styles.rowMeta}>
                {artifactTypeLabel(item.type)} · v{item.currentVersion} ·{' '}
                {formatDateTime(item.updatedAt)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        )}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <ScreenHeader
              title="Artifacts"
              subtitle="Documents, pages, graphics, and code created with Orbit."
              left={<SidebarButton onPress={openSidebar} />}
            />

            <View style={styles.searchWrap}>
              <TextField
                label="Search"
                placeholder="Search artifacts"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {FILTERS.map((option) => {
                const active = filter === option.id;

                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFilter(option.id)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {error ? <FormError message={error} onDismiss={() => setError(null)} /> : null}

            {!loaded ? (
              <View style={styles.skeletons}>
                <Skeleton height={72} radius={radius.md} />
                <Skeleton height={72} radius={radius.md} />
                <Skeleton height={72} radius={radius.md} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loaded ? (
            <EmptyState
              icon={isFiltered ? 'search-outline' : 'cube-outline'}
              title={isFiltered ? 'No matching artifacts' : 'No artifacts yet'}
              message={
                isFiltered
                  ? 'Try a different search or filter.'
                  : 'Ask Orbit to make a document, page, graphic, or code file and it will appear here.'
              }
              actionLabel={isFiltered ? undefined : 'Open Agent'}
              onAction={isFiltered ? undefined : openAgent}
            />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl + insets.bottom },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.md,
    },
    headerBlock: {
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    searchWrap: {},
    filters: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    filterChip: {
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
    },
    filterChipActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    filterText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    filterTextActive: {
      color: colors.accent,
    },
    skeletons: {
      gap: spacing.sm,
    },
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowPressed: {
      opacity: 0.75,
    },
    iconWrap: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 16,
      fontWeight: '600',
    },
    rowMeta: {
      color: colors.textMuted,
      fontSize: 12,
    },
  });
