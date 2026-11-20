import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
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
import { useSidebar } from '@/context/sidebar';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import { colors, radius, spacing } from '@/theme';

type NavItem = {
  label: string;
  caption: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Today',
    caption: 'Aaj ka overview',
    href: '/',
    icon: 'planet-outline',
    activeIcon: 'planet',
  },
  {
    label: 'Agent',
    caption: 'Chat se tasks banao',
    href: '/chat',
    icon: 'sparkles-outline',
    activeIcon: 'sparkles',
  },
  {
    label: 'Tasks',
    caption: 'Sab tasks aur reminders',
    href: '/tasks',
    icon: 'checkbox-outline',
    activeIcon: 'checkbox',
  },
  {
    label: 'Harness',
    caption: 'Plugins aur MCP',
    href: '/harness',
    icon: 'git-network-outline',
    activeIcon: 'git-network',
  },
  {
    label: 'Settings',
    caption: 'AI key aur account',
    href: '/settings',
    icon: 'settings-outline',
    activeIcon: 'settings',
  },
];

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

export function AppSidebar() {
  const { isOpen, close } = useSidebar();
  const { user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  const [aiReady, setAiReady] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const panelWidth = Math.min(width * 0.84, 330);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: isOpen ? 1 : 0,
      duration: isOpen ? 260 : 190,
      easing: isOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isOpen, progress]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const settings = await loadAiSettings();

        if (active) {
          setAiReady(isAiConfigured(settings));
        }
      } catch (loadError) {
        console.warn('Could not load the sidebar status.', loadError);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen]);

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

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Aapka local account is device par rahega.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsSigningOut(true);

            try {
              close();
              await signOut();
            } finally {
              setIsSigningOut(false);
            }
          })();
        },
      },
    ]);
  }

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-panelWidth - 24, 0],
  });

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
        <View pointerEvents="none" style={styles.glow} />

        <View style={styles.brandRow}>
          <Brand size={38} />
          <View style={styles.brandText}>
            <Text style={styles.wordmark}>ORBIT</Text>
            <Text style={styles.tagline}>local-first agent</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            hitSlop={8}
            onPress={close}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={19} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(user.name) || 'O'}</Text>
          </View>
          <View style={styles.profileText}>
            <Text numberOfLines={1} style={styles.profileName}>
              {user.name}
            </Text>
            <Text numberOfLines={1} style={styles.profileEmail}>
              {user.email}
            </Text>
          </View>
        </View>

        <View style={[styles.aiBadge, aiReady ? styles.aiBadgeOn : styles.aiBadgeOff]}>
          <Ionicons
            name={aiReady ? 'sparkles' : 'hardware-chip-outline'}
            size={14}
            color={aiReady ? colors.success : colors.textMuted}
          />
          <Text style={[styles.aiText, { color: aiReady ? colors.success : colors.textMuted }]}>
            {aiReady ? 'Cloud AI ready' : 'Local mode'}
          </Text>
          {!aiReady ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => navigate('/settings')}
              style={styles.aiAction}
            >
              <Text style={styles.aiActionText}>Key add karo</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>NAVIGATE</Text>

        <ScrollView
          style={styles.navScroll}
          contentContainerStyle={styles.navContent}
          showsVerticalScrollIndicator={false}
        >
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' || pathname === '/index' : pathname === item.href;

            return (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => navigate(item.href)}
                style={({ pressed }) => [
                  styles.navItem,
                  active && styles.navItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.navIcon, active && styles.navIconActive]}>
                  <Ionicons
                    name={active ? item.activeIcon : item.icon}
                    size={19}
                    color={active ? colors.accent : colors.textMuted}
                  />
                </View>
                <View style={styles.navText}>
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                    {item.label}
                  </Text>
                  <Text style={styles.navCaption}>{item.caption}</Text>
                </View>
                {active ? <View style={styles.activeDot} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={isSigningOut}
            onPress={confirmSignOut}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>{isSigningOut ? 'Signing out…' : 'Sign out'}</Text>
          </Pressable>

          <Text style={styles.version}>
            Orbit v{Constants.expoConfig?.version ?? '1.3.0'} · Android
          </Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: 'rgba(3, 6, 12, 0.62)',
  },
  backdropPress: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#0A111E',
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderRightWidth: 1,
    borderRightColor: 'rgba(148, 177, 255, 0.2)',
    paddingHorizontal: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    elevation: 24,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -140,
    left: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: colors.accentSoft,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandText: {
    flex: 1,
    gap: 1,
  },
  wordmark: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 4,
  },
  tagline: {
    color: colors.textFaint,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(148, 177, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: spacing.lg,
    backgroundColor: 'rgba(16, 26, 44, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148, 177, 255, 0.14)',
    borderRadius: radius.lg,
    padding: spacing.sm + 2,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  profileEmail: {
    color: colors.textMuted,
    fontSize: 12,
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
  },
  aiBadgeOn: {
    backgroundColor: colors.successSoft,
    borderColor: 'rgba(62, 224, 161, 0.22)',
  },
  aiBadgeOff: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  aiText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  aiAction: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  aiActionText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  navScroll: {
    flex: 1,
  },
  navContent: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  navItemActive: {
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(109, 139, 255, 0.28)',
  },
  navIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconActive: {
    backgroundColor: 'rgba(109, 139, 255, 0.18)',
  },
  navText: {
    flex: 1,
    gap: 1,
  },
  navLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  navLabelActive: {
    color: colors.accent,
  },
  navCaption: {
    color: colors.textFaint,
    fontSize: 11,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 177, 255, 0.12)',
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
  },
  signOutText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  version: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 2,
  },
  pressed: {
    opacity: 0.78,
  },
});
