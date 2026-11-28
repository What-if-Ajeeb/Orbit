import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { TaskSortMode, TaskWorkspaceTab } from '@/lib/task-workspace';
import { radius, spacing } from '@/theme';

type Props = {
  tab: TaskWorkspaceTab;
  sort: TaskSortMode;
  query: string;
  searchOpen: boolean;
  onSelectTab: (tab: TaskWorkspaceTab) => void;
  onCycleSort: () => void;
  onToggleSearch: () => void;
  onQueryChange: (value: string) => void;
};

export function TaskWorkspaceControls({
  tab,
  sort,
  query,
  searchOpen,
  onSelectTab,
  onCycleSort,
  onToggleSearch,
  onQueryChange,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(
            [
              { id: 'active', label: 'Active' },
              { id: 'up-next', label: 'Up next' },
            ] as const
          ).map((item) => {
            const selected = tab === item.id;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => onSelectTab(item.id)}
                style={({ pressed }) => [styles.tab, selected && styles.tabSelected, pressed && styles.pressed]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sort tasks: ${sort}. Change sort order`}
            hitSlop={8}
            onPress={onCycleSort}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="swap-vertical-outline" size={19} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? 'Close task search' : 'Search tasks'}
            accessibilityState={{ expanded: searchOpen }}
            hitSlop={8}
            onPress={onToggleSearch}
            style={({ pressed }) => [
              styles.iconButton,
              searchOpen && styles.iconButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={searchOpen ? 'close-outline' : 'search-outline'} size={19} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {searchOpen ? (
        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={16} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search tasks"
            accessibilityLabel="Search tasks"
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.accent}
            style={styles.searchInput}
            autoCorrect={false}
            maxLength={120}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    wrap: {
      gap: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    tabs: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      padding: 3,
    },
    tab: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
    },
    tabSelected: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pressed: {
      opacity: 0.7,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    tabTextSelected: {
      color: colors.text,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iconButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    iconButtonActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      minHeight: 42,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
    },
  });
