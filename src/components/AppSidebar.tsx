import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getChatStore, type Conversation } from '@/lib/chat';
import { fonts, radius, spacing } from '@/theme';

type NavItem = {
  label: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const MAIN_ITEMS: NavItem[] = [
  { label: 'Today', href: '/', icon: 'planet-outline', activeIcon: 'planet' },
  { label: 'Agent', href: '/chat', icon: 'sparkles-outline', activeIcon: 'sparkles' },
  { label: 'AI Agents', href: '/agents' as Href, icon: 'people-outline', activeIcon: 'people' },
  { label: 'Conversations', href: '/conversations' as Href, icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  { label: 'Connections', href: '/connections' as Href, icon: 'cloud-outline', activeIcon: 'cloud' },
  { label: 'Marketplace', href: '/marketplace' as Href, icon: 'storefront-outline', activeIcon: 'storefront' },
  { label: 'Tasks', href: '/tasks', icon: 'checkbox-outline', activeIcon: 'checkbox' },
  { label: 'Workflows', href: '/workflows', icon: 'flash-outline', activeIcon: 'flash' },
  { label: 'Artifacts', href: '/artifacts', icon: 'cube-outline', activeIcon: 'cube' },
  { label: 'Buddy', href: '/buddy', icon: 'paw-outline', activeIcon: 'paw' },
  { label: 'Settings', href: '/settings', icon: 'settings-outline', activeIcon: 'settings' },
];

const ADVANCED_ITEMS: NavItem[] = [
  { label: 'Plugins', href: '/plugins' as Href, icon: 'extension-puzzle-outline', activeIcon: 'extension-puzzle' },
  { label: 'Harness', href: '/harness', icon: 'git-network-outline', activeIcon: 'git-network' },
  { label: 'Events', href: '/events', icon: 'receipt-outline', activeIcon: 'receipt' },
  { label: 'Telemetry', href: '/telemetry', icon: 'analytics-outline', activeIcon: 'analytics' },
  {
    label: 'Policy',
    href: '/policy',
    icon: 'shield-checkmark-outline',
    activeIcon: 'shield-checkmark',
  },
  {
    label: 'Permissions',
    href: '/permissions' as Href,
    icon: 'finger-print-outline',
    activeIcon: 'finger-print',
  },
  {
    label: 'Tool permissions',
    href: '/tool-permissions' as Href,
    icon: 'key-outline',
    activeIcon: 'key',
  },
  {
    label: 'Approvals',
    href: '/approvals' as Href,
    icon: 'checkmark-done-outline',
    activeIcon: 'checkmark-done',
  },
];

const RECENT_LIMIT = 8;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function navIcon(name: string): keyof typeof Ionicons.glyphMap {
  return name in Ionicons.glyphMap
    ? (name as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

/** Links into the chat screen carry a timestamp so repeating the same action works twice. */
function chatLink(params: Record<string, string | number>): Href {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `/chat?${query}&t=${Date.now()}` as Href;
}

export function AppSidebar() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { isOpen, close } = useSidebar();
  const { user } = useSession();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const { navigation } = usePluginSnapshot();
  const [progress] = useState(() => new Animated.Value(0));
  const [recents, setRecents] = useState<Conversation[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const panelWidth = Math.min(width * 0.86, 340);
  const userId = user?.id;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isOpen ? 1 : 0,
      duration: isOpen ? 240 : 180,
      easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isOpen, progress]);

  // Refresh "Recents" every time the drawer opens.
  useEffect(() => {
    if (!isOpen || userId === undefined) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const list = await getChatStore(db).listConversations(userId);

        if (active) {
          setRecents(list.filter((item) => item.messageCount > 0).slice(0, RECENT_LIMIT));
        }
      } catch (loadError) {
        console.warn('Could not load recent chats.', loadError);
      }
    })();

    return () => {
      active = false;
    };
  }, [db, isOpen, userId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });

    return () => subscription.remove();
  }, [close, isOpen]);

  if (!user) {
    return null;
  }

  function navigate(href: Href) {
    close();
    router.navigate(href);
  }

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth - 24, 0],
  });

  function isActive(href: Href): boolean {
    return href === '/' ? pathname === '/' || pathname === '/index' : pathname === href || pathname.startsWith(`${href}/`);
  }

  function renderNavRow(item: NavItem, compact = false) {
    const active = isActive(item.href);

    return (
      <Pressable
        key={item.label}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={() => navigate(item.href)}
        style={({ pressed }) => [
          styles.navItem,
          compact && styles.navItemCompact,
          active && styles.navItemActive,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={active ? item.activeIcon : item.icon}
          size={compact ? 20 : 24}
          color={active ? colors.text : colors.textMuted}
        />
        <Text style={[styles.navLabel, compact && styles.navLabelCompact, active && styles.navLabelActive]}>
          {item.label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={styles.overlay}
      accessibilityViewIsModal={isOpen}
    >
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={close}
          style={styles.backdropPress}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.md,
            paddingBottom: Math.max(insets.bottom, spacing.md),
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.brandRow}>
          <Brand size={32} />
          <Text accessibilityRole="header" style={styles.wordmark}>
            Orbit
          </Text>
        </View>

        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
          showsVerticalScrollIndicator={false}
        >
          {MAIN_ITEMS.map((item) => renderNavRow(item))}

          {navigation.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>Plugin apps</Text>
              {navigation.map((entry) => {
                const active = pathname.startsWith(`/plugin/${entry.pluginId}`);

                return (
                  <Pressable
                    key={`${entry.pluginId}:${entry.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => navigate(entry.path as Href)}
                    style={({ pressed }) => [
                      styles.navItem,
                      active && styles.navItemActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={navIcon(entry.icon)}
                      size={24}
                      color={active ? colors.text : colors.textMuted}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.navLabel, active && styles.navLabelActive]}
                    >
                      {entry.label}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>Recents</Text>

          {recents.length === 0 ? (
            <Text style={styles.recentEmpty}>Your conversations will show up here.</Text>
          ) : (
            recents.map((chat) => (
              <Pressable
                key={chat.id}
                accessibilityRole="button"
                accessibilityLabel={`Open chat ${chat.title}`}
                onPress={() => navigate(chatLink({ c: chat.id }))}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
              >
                <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
                <Text numberOfLines={1} style={styles.recentTitle}>
                  {chat.title}
                </Text>
              </Pressable>
            ))
          )}

          {recents.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => navigate(chatLink({ h: 1 }))}
              style={({ pressed }) => [styles.allChats, pressed && styles.pressed]}
            >
              <Text style={styles.allChatsText}>All chats</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}

          <View style={styles.divider} />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            onPress={() => setAdvancedOpen((open) => !open)}
            style={({ pressed }) => [styles.allChats, pressed && styles.pressed]}
          >
            <Text style={styles.sectionLabelInline}>Advanced</Text>
            <Ionicons
              name={advancedOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textMuted}
            />
          </Pressable>

          {advancedOpen ? ADVANCED_ITEMS.map((item) => renderNavRow(item, true)) : null}
        </ScrollView>

        <View style={styles.bottomBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => navigate('/settings')}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{getInitials(user.name) || 'O'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            onPress={() => navigate(chatLink({ n: 1 }))}
            style={({ pressed }) => [styles.newChat, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={22} color={colors.onInverse} />
            <Text style={styles.newChatText}>New chat</Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 60,
      elevation: 60,
    },
    backdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    backdropPress: {
      flex: 1,
    },
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: spacing.md,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    wordmark: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 32,
      fontWeight: '600',
      letterSpacing: -0.4,
    },
    navScroll: {
      flex: 1,
    },
    navContent: {
      paddingBottom: spacing.md,
    },
    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 56,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
    },
    navItemCompact: {
      minHeight: 48,
      paddingLeft: spacing.lg,
    },
    navItemActive: {
      backgroundColor: colors.surface,
    },
    navLabel: {
      color: colors.textMuted,
      fontSize: 18,
      fontWeight: '500',
    },
    navLabelCompact: {
      fontSize: 16,
    },
    navLabelActive: {
      color: colors.text,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.md,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '600',
      paddingHorizontal: spacing.sm + 2,
      marginBottom: spacing.xs,
    },
    sectionLabelInline: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '600',
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 48,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
    },
    recentTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
    },
    recentEmpty: {
      color: colors.textFaint,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    allChats: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      minHeight: 48,
      paddingHorizontal: spacing.sm + 2,
    },
    allChatsText: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '600',
    },
    bottomBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.md,
    },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: colors.onInverse,
      fontSize: 20,
      fontWeight: '700',
    },
    newChat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      height: 52,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
    },
    newChatText: {
      color: colors.onInverse,
      fontSize: 16,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.8,
    },
  });
