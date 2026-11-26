import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { PinnedPluginTree } from '@/components/plugins/PinnedPluginTree';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getChatStore, type Conversation } from '@/lib/chat';
import { fonts, layout, motion, radius, spacing, typography } from '@/theme';

type NavItem = {
  label: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

type SidebarVariant = 'overlay' | 'persistent';

type SidebarContentProps = {
  variant?: SidebarVariant;
  collapsed?: boolean;
  active?: boolean;
  onCollapse?: () => void;
  onNavigate: (href: Href) => void;
  onAccountSwitched?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** The six destinations from the ORBIT sidebar reference. */
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: 'Chats', href: '/chat', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
  {
    label: 'Projects',
    href: '/projects' as Href,
    icon: 'briefcase-outline',
    activeIcon: 'briefcase',
  },
  {
    label: 'Plugins',
    href: '/plugins' as Href,
    icon: 'extension-puzzle-outline',
    activeIcon: 'extension-puzzle',
  },
  {
    label: 'Marketplace',
    href: '/marketplace' as Href,
    icon: 'storefront-outline',
    activeIcon: 'storefront',
  },
  { label: 'Buddy', href: '/buddy', icon: 'paw-outline', activeIcon: 'paw' },
  { label: 'Settings', href: '/settings', icon: 'settings-outline', activeIcon: 'settings' },
];

const RECENT_LIMIT = 6;

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 1)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

export function chatLink(params: Record<string, string | number>): Href {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `/chat?${query}&t=${Date.now()}` as Href;
}

export function isNavActive(pathname: string, href: Href): boolean {
  const target = String(href);

  if (target === '/') {
    return pathname === '/' || pathname === '/index';
  }

  if (target === '/plugins') {
    return pathname === '/plugins' || pathname.startsWith('/plugins/') || pathname.startsWith('/plugin/');
  }

  return pathname === target || pathname.startsWith(`${target}/`);
}

function navIcon(name: string): keyof typeof Ionicons.glyphMap {
  return name in Ionicons.glyphMap
    ? (name as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

/**
 * Shared sidebar contents. The overlay drawer and the persistent tablet sidebar
 * render the same destinations, pinned plugins, recents and account footer.
 */
export function SidebarContent({
  variant = 'overlay',
  collapsed = false,
  active = true,
  onCollapse,
  onNavigate,
  onAccountSwitched,
  style,
}: SidebarContentProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { user, accounts, switchAccount } = useSession();
  const db = useSQLiteContext();
  const pathname = usePathname();
  const snapshot = usePluginSnapshot();
  const [recents, setRecents] = useState<Conversation[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const userId = user?.id;
  const navigation = snapshot.navigation ?? [];

  useEffect(() => {
    if (!active || userId === undefined) {
      return;
    }

    let mounted = true;

    void (async () => {
      try {
        const list = await getChatStore(db).listConversations(userId);

        if (mounted) {
          setRecents(list.filter((item) => item.messageCount > 0).slice(0, RECENT_LIMIT));
        }
      } catch (loadError) {
        console.warn('Could not load recent chats.', loadError);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [active, db, userId]);

  if (!user) {
    return null;
  }

  function navigate(href: Href) {
    onNavigate(href);
  }

  async function selectAccount(nextUserId: number) {
    setAccountMenuOpen(false);

    if (nextUserId === userId) {
      onAccountSwitched?.();
      return;
    }

    try {
      await switchAccount(nextUserId);
      onAccountSwitched?.();
      router.replace('/');
    } catch (switchError) {
      const message =
        switchError instanceof Error ? switchError.message : 'The account could not be switched.';
      Alert.alert('Account switch failed', message);
    }
  }

  function renderNavRow(item: NavItem) {
    const activeItem = isNavActive(pathname, item.href);

    return (
      <Pressable
        key={item.label}
        accessibilityRole="button"
        accessibilityLabel={collapsed ? item.label : undefined}
        accessibilityState={{ selected: activeItem }}
        onPress={() => navigate(item.href)}
        style={({ pressed }) => [
          collapsed ? styles.navItemRail : styles.navItem,
          activeItem && styles.navItemActive,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={activeItem ? item.activeIcon : item.icon}
          size={22}
          color={activeItem ? colors.accent : colors.textMuted}
        />
        {!collapsed ? (
          <Text
            numberOfLines={1}
            style={[styles.navLabel, activeItem && styles.navLabelActive]}
          >
            {item.label}
          </Text>
        ) : null}
        {activeItem && !collapsed ? <View style={styles.activeMark} /> : null}
      </Pressable>
    );
  }

  const visibleAccounts = accounts.length > 0 ? accounts : [user];
  const canSwitchAccount = visibleAccounts.length > 1;

  return (
    <View style={[styles.content, collapsed && styles.contentRail, style]}>
      <View style={[styles.headerRow, collapsed && styles.headerRowRail]}>
        <Brand size={30} />
        {!collapsed ? (
          <Text accessibilityRole="header" style={styles.wordmark}>
            ORBIT
          </Text>
        ) : null}
        {onCollapse ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            hitSlop={8}
            onPress={onCollapse}
            style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}
          >
            <Ionicons
              name={collapsed ? 'chevron-forward' : 'chevron-back'}
              size={20}
              color={colors.textMuted}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.navScroll}
        contentContainerStyle={styles.navContent}
        showsVerticalScrollIndicator={false}
      >
        {!collapsed ? <Text style={styles.primaryLabel}>WORKSPACE</Text> : null}
        {PRIMARY_NAV_ITEMS.map(renderNavRow)}

        <View style={styles.divider} />

        <PinnedPluginTree collapsed={collapsed} onNavigate={navigate} />

        {!collapsed ? (
          <>
            <View style={styles.divider} />

            <View style={styles.sectionBlock}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open chat history"
                onPress={() => navigate('/conversations' as Href)}
                style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}
              >
                <Ionicons name="library-outline" size={18} color={colors.textMuted} />
                <Text style={styles.recentTitle}>All conversations</Text>
              </Pressable>
            </View>

            {variant === 'overlay' && navigation.length > 0 ? (
              <>
                <View style={styles.divider} />
                <View style={styles.sectionBlock}>
                  <Text style={styles.sectionLabel}>Plugin apps</Text>
                  {navigation.map((entry) => {
                    const activeItem = pathname.startsWith(`/plugin/${entry.pluginId}`);

                    return (
                      <Pressable
                        key={`${entry.pluginId}:${entry.id}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activeItem }}
                        onPress={() => navigate(entry.path as Href)}
                        style={({ pressed }) => [
                          styles.navItemCompact,
                          activeItem && styles.navItemActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Ionicons
                          name={navIcon(entry.icon)}
                          size={20}
                          color={activeItem ? colors.accent : colors.textMuted}
                        />
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.navLabel,
                            styles.navLabelCompact,
                            activeItem && styles.navLabelActive,
                          ]}
                        >
                          {entry.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            {accountMenuOpen ? (
              <View style={styles.accountMenu}>
                <Text style={styles.sectionLabel}>Accounts on this device</Text>
                {visibleAccounts.map((account) => {
                  const activeAccount = account.id === userId;

                  return (
                    <Pressable
                      key={account.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activeAccount }}
                      onPress={() => void selectAccount(account.id)}
                      style={({ pressed }) => [styles.accountRow, pressed && styles.pressed]}
                    >
                      <View style={[styles.smallAvatar, activeAccount && styles.smallAvatarActive]}>
                        <Text style={styles.smallAvatarText}>
                          {getInitials(account.name) || 'O'}
                        </Text>
                      </View>
                      <View style={styles.accountText}>
                        <Text numberOfLines={1} style={styles.accountName}>
                          {account.name}
                        </Text>
                        <Text numberOfLines={1} style={styles.accountEmail}>
                          {account.email}
                        </Text>
                      </View>
                      {activeAccount ? (
                        <Ionicons name="checkmark" size={18} color={colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <View style={[styles.bottomBar, collapsed && styles.bottomBarRail]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canSwitchAccount ? 'Switch account' : 'Account settings'}
          accessibilityState={canSwitchAccount ? { expanded: accountMenuOpen } : undefined}
          onPress={() => {
            if (!canSwitchAccount) {
              onNavigate('/settings/account' as Href);
              return;
            }

            setAccountMenuOpen((value) => !value);
          }}
          style={({ pressed }) => [
            styles.bottomUser,
            collapsed && styles.bottomUserRail,
            accountMenuOpen && styles.bottomUserActive,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(user.name) || 'O'}</Text>
          </View>
          {!collapsed ? (
            <View style={styles.bottomUserText}>
              <Text numberOfLines={1} style={styles.bottomUserName}>
                {user.name}
              </Text>
              <Text numberOfLines={1} style={styles.bottomUserHint}>
                {canSwitchAccount ? 'Switch account' : 'Account settings'}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          onPress={() => navigate(chatLink({ n: 1 }))}
          style={({ pressed }) => [
            styles.newChat,
            collapsed && styles.newChatRail,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="add" size={20} color={colors.onInverse} />
          {!collapsed ? <Text style={styles.newChatText}>New chat</Text> : null}
        </Pressable>
      </View>
    </View>
  );
}

/** Phone and tablet-portrait overlay drawer. */
export function AppSidebar() {
  const styles = useStyles(makeStyles);
  const { isOpen, open, close } = useSidebar();
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  const [dragX] = useState(() => new Animated.Value(0));

  const panelWidth = Math.min(width * 0.86, 340);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isOpen ? 1 : 0,
      duration: isOpen ? motion.normal + 40 : motion.fast + 60,
      easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isOpen, progress]);

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

  // Deep links and notification taps can change routes without using navigate().
  const lastPathname = useRef(pathname);

  useEffect(() => {
    if (lastPathname.current !== pathname) {
      lastPathname.current = pathname;

      if (isOpen) {
        close();
      }
    }
  }, [close, isOpen, pathname]);

  const settleDrag = useCallback(() => {
    Animated.timing(dragX, {
      toValue: 0,
      duration: motion.fast,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [dragX]);

  const openResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (_event, gesture) => !isOpen && gesture.x0 <= 28,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !isOpen && gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          dragX.setValue(Math.max(0, Math.min(panelWidth, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          settleDrag();

          if (gesture.dx > 48 || gesture.vx > 0.35) {
            open();
          }
        },
        onPanResponderTerminate: () => settleDrag(),
      }),
    [dragX, isOpen, open, panelWidth, settleDrag]
  );

  const closeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          isOpen && gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          dragX.setValue(Math.max(-panelWidth, Math.min(0, gesture.dx)));
        },
        onPanResponderRelease: (_event, gesture) => {
          settleDrag();

          if (gesture.dx < -Math.min(80, panelWidth * 0.25) || gesture.vx < -0.35) {
            close();
          }
        },
        onPanResponderTerminate: () => settleDrag(),
      }),
    [close, dragX, isOpen, panelWidth, settleDrag]
  );

  if (!user) {
    return null;
  }

  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth - 24, 0],
  });
  const panelTranslateX = Animated.add(translateX, dragX);

  function navigate(href: Href) {
    close();
    router.navigate(href);
  }

  return (
    <Animated.View
      pointerEvents={isOpen ? 'auto' : 'box-none'}
      style={styles.overlay}
      accessibilityViewIsModal={isOpen}
    >
      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          onPress={close}
          style={styles.backdropPress}
        />
      </Animated.View>

      {!isOpen ? (
        <View
          accessibilityLabel="Swipe right to open navigation"
          style={styles.edgeZone}
          {...openResponder.panHandlers}
        >
          <View style={styles.edgeHandle} />
        </View>
      ) : null}

      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        accessibilityElementsHidden={!isOpen}
        importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.md,
            paddingBottom: Math.max(insets.bottom, spacing.md),
            transform: [{ translateX: panelTranslateX }],
          },
        ]}
        {...closeResponder.panHandlers}
      >
        <SidebarContent
          active={isOpen}
          onCollapse={close}
          onNavigate={navigate}
          onAccountSwitched={close}
        />
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
    edgeZone: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    edgeHandle: {
      width: 3,
      height: 48,
      borderRadius: 2,
      backgroundColor: colors.accentSoft,
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
    content: {
      flex: 1,
    },
    contentRail: {
      alignItems: 'center',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xs,
      paddingBottom: spacing.md,
    },
    headerRowRail: {
      flexDirection: 'column',
      gap: spacing.sm,
      paddingHorizontal: 0,
    },
    wordmark: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.serif,
      ...typography.title,
      letterSpacing: 2,
    },
    collapseButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    navScroll: {
      flex: 1,
    },
    navContent: {
      paddingBottom: spacing.md,
    },
    primaryLabel: {
      color: colors.textFaint,
      ...typography.overline,
      paddingHorizontal: spacing.sm,
      marginBottom: spacing.sm,
    },
    sectionBlock: {
      gap: 2,
    },
    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.touchTarget + 4,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
    },
    navItemCompact: {
      minHeight: layout.touchTarget,
      paddingLeft: spacing.lg,
    },
    navItemRail: {
      width: layout.touchTarget + 8,
      minHeight: layout.touchTarget + 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
    },
    navItemActive: {
      backgroundColor: colors.accentSoft,
    },
    navLabel: {
      flex: 1,
      color: colors.textMuted,
      ...typography.body,
    },
    navLabelCompact: {
      ...typography.bodySmall,
    },
    navLabelActive: {
      color: colors.accent,
      fontWeight: '600',
    },
    activeMark: {
      width: 4,
      height: 20,
      borderRadius: 2,
      backgroundColor: colors.accent,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.md,
    },
    sectionLabel: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
      paddingHorizontal: spacing.sm + 2,
      marginBottom: spacing.xs,
    },
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.touchTarget,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
    },
    recentTitle: {
      flex: 1,
      color: colors.text,
      ...typography.bodySmall,
    },
    recentEmpty: {
      color: colors.textFaint,
      ...typography.bodySmall,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    accountMenu: {
      gap: spacing.xs,
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    smallAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    smallAvatarActive: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    smallAvatarText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    accountText: {
      flex: 1,
      gap: 2,
    },
    accountName: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    accountEmail: {
      color: colors.textFaint,
      ...typography.caption,
    },
    bottomBar: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    bottomBarRail: {
      alignItems: 'center',
    },
    bottomUser: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget + 8,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    bottomUserRail: {
      paddingHorizontal: 0,
    },
    bottomUserActive: {
      backgroundColor: colors.accentSoft,
    },
    bottomUserText: {
      flex: 1,
      gap: 2,
    },
    bottomUserName: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    bottomUserHint: {
      color: colors.textFaint,
      ...typography.caption,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: colors.onInverse,
      fontSize: 18,
      fontWeight: '700',
    },
    newChat: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      minHeight: layout.touchTarget + 4,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
    },
    newChatRail: {
      width: layout.touchTarget,
      paddingHorizontal: 0,
    },
    newChatText: {
      color: colors.onInverse,
      ...typography.button,
    },
    pressed: {
      opacity: 0.8,
    },
  });
