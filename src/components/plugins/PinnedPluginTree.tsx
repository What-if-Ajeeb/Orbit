import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AlertButton,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePinnedPlugins } from '@/context/pinned-plugins';
import { usePluginSnapshot } from '@/context/plugins';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isInstalledPluginStatus } from '@/lib/plugins/status';
import {
  MAX_PINNED_PLUGINS,
  PINNED_PLUGIN_GROUP_IDS,
  PINNED_PLUGIN_GROUP_LABELS,
  type PinnedPluginGroupId,
} from '@/lib/pinned-plugins';
import { layout, radius, spacing, typography } from '@/theme';

type PinnedPluginTreeProps = {
  collapsed?: boolean;
  onNavigate: (href: Href) => void;
};

type TreeRow = {
  id: string;
  label: string;
  icon: string;
  href: Href;
};

type RowActionsProps = {
  row: TreeRow;
  groupId: PinnedPluginGroupId;
  index: number;
  count: number;
  active: boolean;
  collapsedRail: boolean;
  onNavigate: (href: Href) => void;
  onOpenActions: (row: TreeRow, groupId: PinnedPluginGroupId, index: number, count: number) => void;
  onReorder: (pluginId: string, groupId: PinnedPluginGroupId, targetIndex: number) => void;
};

/** Row stride used to turn a vertical drag into a stable index change. */
export const PINNED_ROW_STRIDE = layout.touchTarget + 4;

function navIcon(name: string): keyof typeof Ionicons.glyphMap {
  return name in Ionicons.glyphMap
    ? (name as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

function PinnedPluginRow({
  row,
  groupId,
  index,
  count,
  active,
  collapsedRail,
  onNavigate,
  onOpenActions,
  onReorder,
}: RowActionsProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [dragging, setDragging] = useState(false);
  const [dragY] = useState(() => new Animated.Value(0));

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          const min = -index * PINNED_ROW_STRIDE;
          const max = Math.max(0, count - 1 - index) * PINNED_ROW_STRIDE;
          dragY.setValue(Math.max(min, Math.min(max, gesture.dy)));
        },
        onPanResponderRelease: (_event, gesture) => {
          setDragging(false);
          dragY.setValue(0);

          const offset = Math.round(gesture.dy / PINNED_ROW_STRIDE);

          if (offset !== 0) {
            onReorder(row.id, groupId, index + offset);
          }
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          dragY.setValue(0);
        },
      }),
    [count, dragY, groupId, index, onReorder, row.id]
  );

  if (collapsedRail) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.label}
        accessibilityState={{ selected: active }}
        onPress={() => onNavigate(row.href)}
        onLongPress={() => onOpenActions(row, groupId, index, count)}
        style={({ pressed }) => [
          styles.railRow,
          active && styles.railRowActive,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={navIcon(row.icon)}
          size={20}
          color={active ? colors.accent : colors.textMuted}
        />
      </Pressable>
    );
  }

  return (
    <Animated.View
      style={[
        styles.treeRow,
        dragging && styles.treeRowDragging,
        { transform: [{ translateY: dragY }] },
      ]}
    >
      <View style={styles.connector} />
      <View style={[styles.rowSurface, active && styles.rowSurfaceActive]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Drag ${row.label} to reorder`}
          hitSlop={4}
          {...pan.panHandlers}
          style={({ pressed }) => [styles.dragHandle, pressed && styles.pressed]}
        >
          <Ionicons
            name="reorder-two-outline"
            size={16}
            color={active ? colors.accent : colors.textFaint}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={row.label}
          accessibilityState={{ selected: active }}
          onPress={() => onNavigate(row.href)}
          onLongPress={() => onOpenActions(row, groupId, index, count)}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        >
          <Ionicons
            name={navIcon(row.icon)}
            size={18}
            color={active ? colors.accent : colors.textMuted}
          />
          <Text
            numberOfLines={1}
            style={[styles.rowLabel, active && styles.rowLabelActive]}
          >
            {row.label}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Options for ${row.label}`}
          hitSlop={4}
          onPress={() => onOpenActions(row, groupId, index, count)}
          style={({ pressed }) => [styles.rowMore, pressed && styles.pressed]}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={16}
            color={active ? colors.accent : colors.textFaint}
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/**
 * Nested navigation for shortcuts pinned from the installed plugin list. This
 * only drives `/plugin/<id>` navigation; it never installs or executes plugins.
 */
export function PinnedPluginTree({
  collapsed = false,
  onNavigate,
}: PinnedPluginTreeProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const snapshot = usePluginSnapshot();
  const {
    groups,
    collapsedGroupIds,
    pinnedIds,
    pinPlugin,
    unpinPlugin,
    movePinnedPlugin,
    movePinnedPluginToGroup,
    toggleGroup,
  } = usePinnedPlugins();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const rowsById = useMemo(() => {
    const rows = new Map<string, TreeRow>();

    for (const summary of snapshot.summaries ?? []) {
      const pluginId = summary.manifest.pluginId;

      if (
        rows.has(pluginId) ||
        summary.legacy ||
        !isInstalledPluginStatus(summary.status)
      ) {
        continue;
      }

      rows.set(pluginId, {
        id: pluginId,
        label: summary.manifest.name,
        icon: summary.manifest.icon ?? 'extension-puzzle-outline',
        href: `/plugin/${encodeURIComponent(pluginId)}` as Href,
      });
    }

    return rows;
  }, [snapshot.summaries]);

  const availablePlugins = useMemo(() => {
    if (pinnedIds.length >= MAX_PINNED_PLUGINS) {
      return [];
    }

    const search = query.trim().toLowerCase();

    return [...rowsById.values()]
      .filter((row) => !pinnedIds.includes(row.id))
      .filter((row) => row.label.toLowerCase().includes(search))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [pinnedIds, query, rowsById]);

  const hasPinnedRows = groups.some((group) =>
    group.pluginIds.some((pluginId) => rowsById.has(pluginId))
  );

  const openActions = useMemo(
    () =>
      (
        row: TreeRow,
        groupId: PinnedPluginGroupId,
        index: number,
        count: number
      ) => {
        const otherGroup: PinnedPluginGroupId =
          groupId === 'everything' ? 'more' : 'everything';

        const actions: AlertButton[] = [];

        if (index > 0) {
          actions.push({
            text: 'Move up',
            onPress: () => movePinnedPlugin(row.id, groupId, index - 1),
          });
        }

        if (index < count - 1) {
          actions.push({
            text: 'Move down',
            onPress: () => movePinnedPlugin(row.id, groupId, index + 1),
          });
        }

        actions.push(
          {
            text: `Move to ${PINNED_PLUGIN_GROUP_LABELS[otherGroup]}`,
            onPress: () => movePinnedPluginToGroup(row.id, otherGroup),
          },
          {
            text: 'Unpin',
            style: 'destructive',
            onPress: () => unpinPlugin(row.id),
          },
          { text: 'Cancel', style: 'cancel' }
        );

        Alert.alert(row.label, 'Reorder, move or remove this pinned shortcut.', actions);
      },
    [movePinnedPlugin, movePinnedPluginToGroup, unpinPlugin]
  );

  const reorder = useMemo(
    () =>
      (pluginId: string, groupId: PinnedPluginGroupId, targetIndex: number) => {
        movePinnedPlugin(pluginId, groupId, targetIndex);
      },
    [movePinnedPlugin]
  );

  function addPlugin(pluginId: string) {
    pinPlugin(pluginId, 'everything');
    setPickerOpen(false);
    setQuery('');
  }

  function renderGroup(groupId: PinnedPluginGroupId) {
    const group = groups.find((item) => item.id === groupId);
    const rows = (group?.pluginIds ?? [])
      .map((pluginId) => rowsById.get(pluginId))
      .filter((row): row is TreeRow => Boolean(row));
    const expanded = !collapsedGroupIds.includes(groupId);
    const label = PINNED_PLUGIN_GROUP_LABELS[groupId];

    return (
      <View key={groupId} style={styles.groupBlock}>
        {!collapsed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${label} group`}
            accessibilityState={{ expanded }}
            onPress={() => toggleGroup(groupId)}
            style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}
          >
            <Ionicons
              name={expanded ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.textMuted}
            />
            <Ionicons
              name={groupId === 'everything' ? 'layers-outline' : 'folder-outline'}
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.groupLabel}>{label}</Text>
            <Text style={styles.groupCount}>{rows.length}</Text>
          </Pressable>
        ) : null}

        {expanded ? (
          <View style={collapsed ? styles.railChildren : styles.children}>
            {rows.map((row, index) => (
              <PinnedPluginRow
                key={row.id}
                row={row}
                groupId={groupId}
                index={index}
                count={rows.length}
                active={pathname.startsWith(`/plugin/${row.id}`)}
                collapsedRail={collapsed}
                onNavigate={onNavigate}
                onOpenActions={openActions}
                onReorder={reorder}
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.sectionBlock}>
      {!collapsed ? (
        <View style={styles.sectionHeading}>
          <Ionicons name="layers-outline" size={16} color={colors.textMuted} />
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            Pinned
          </Text>
        </View>
      ) : null}

      {PINNED_PLUGIN_GROUP_IDS.map(renderGroup)}

      {!hasPinnedRows && !collapsed ? (
        <Text style={styles.emptyText}>No pinned plugins yet.</Text>
      ) : null}

      {!collapsed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pin plugin"
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.pinAction, pressed && styles.pressed]}
        >
          <Ionicons name="add-circle-outline" size={17} color={colors.accent} />
          <Text style={styles.pinActionLabel}>Pin plugin</Text>
        </Pressable>
      ) : null}

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View
          style={[
            styles.modal,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              Pin a plugin
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close plugin picker"
              hitSlop={8}
              onPress={() => setPickerOpen(false)}
              style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <TextInput
            accessibilityLabel="Search installed plugins"
            onChangeText={setQuery}
            placeholder="Search installed plugins"
            placeholderTextColor={colors.textFaint}
            style={styles.search}
            value={query}
          />

          <ScrollView
            style={styles.modalList}
            contentContainerStyle={styles.modalListContent}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            {availablePlugins.length === 0 ? (
              <Text style={styles.emptyText}>
                {pinnedIds.length >= MAX_PINNED_PLUGINS
                  ? 'Unpin a plugin to add another.'
                  : 'No installed plugins available.'}
              </Text>
            ) : (
              availablePlugins.map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${row.label}`}
                  onPress={() => addPlugin(row.id)}
                  style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
                >
                  <Ionicons
                    name={navIcon(row.icon)}
                    size={18}
                    color={colors.textMuted}
                  />
                  <Text numberOfLines={1} style={styles.pickerLabel}>
                    {row.label}
                  </Text>
                  <Ionicons name="add" size={18} color={colors.accent} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    sectionBlock: {
      gap: 2,
    },
    sectionHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm + 2,
      marginBottom: spacing.xs,
    },
    sectionLabel: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    groupBlock: {
      gap: 2,
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: layout.touchTarget - 8,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.sm,
    },
    groupLabel: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    groupCount: {
      color: colors.textFaint,
      ...typography.caption,
    },
    children: {
      marginLeft: spacing.lg,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    railChildren: {
      alignItems: 'center',
    },
    treeRow: {
      minHeight: layout.touchTarget,
      zIndex: 1,
    },
    treeRowDragging: {
      zIndex: 3,
    },
    connector: {
      position: 'absolute',
      left: 0,
      top: layout.touchTarget / 2,
      width: spacing.sm,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    rowSurface: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: layout.touchTarget - 4,
      marginLeft: spacing.sm,
      marginVertical: 2,
      paddingLeft: 2,
      paddingRight: spacing.xs,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'transparent',
    },
    rowSurfaceActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    dragHandle: {
      width: 28,
      minHeight: layout.touchTarget - 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget - 12,
    },
    rowLabel: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    rowLabelActive: {
      color: colors.accent,
      fontWeight: '600',
    },
    rowMore: {
      width: 26,
      minHeight: layout.touchTarget - 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railRow: {
      width: layout.touchTarget + 8,
      minHeight: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    railRowActive: {
      backgroundColor: colors.accentSoft,
    },
    emptyText: {
      color: colors.textFaint,
      ...typography.bodySmall,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    pinAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: layout.touchTarget - 8,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.sm,
    },
    pinActionLabel: {
      color: colors.accent,
      ...typography.bodySmall,
    },
    pressed: {
      opacity: 0.72,
    },
    modal: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    modalTitle: {
      flex: 1,
      color: colors.text,
      ...typography.section,
    },
    modalClose: {
      width: layout.iconButton,
      height: layout.iconButton,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    search: {
      minHeight: layout.touchTarget,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      ...typography.bodySmall,
    },
    modalList: {
      flex: 1,
      marginTop: spacing.sm,
    },
    modalListContent: {
      paddingVertical: spacing.xs,
      gap: 2,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.touchTarget + 4,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    pickerLabel: {
      flex: 1,
      color: colors.text,
      ...typography.bodySmall,
    },
  });
