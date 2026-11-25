import Constants from 'expo-constants';
import { router, useFocusEffect, type Href } from 'expo-router';
import {
  Activity,
  Bell,
  Brain,
  ChevronRight,
  CircleHelp,
  Cloud,
  Cpu,
  Database,
  History,
  Link2,
  ListChecks,
  LogOut,
  MessagesSquare,
  Palette,
  Puzzle,
  SearchX,
  Server,
  ShieldCheck,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsSearch } from '@/components/settings/SettingsSearch';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isAiConfigured, loadAiSettings, type AiSettings } from '@/lib/ai/settings';
import {
  getNotificationPermission,
  type NotificationPermissionState,
} from '@/lib/notifications';
import { fonts, layout, radius, spacing, typography } from '@/theme';

type SettingsEntry = {
  id: string;
  group: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href?: Href;
  action?: 'signOut';
  keywords?: string[];
  destructive?: boolean;
  value?: string;
};

type SettingsGroupData = {
  title: string;
  items: SettingsEntry[];
};

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

const PERMISSION_VALUES: Record<NotificationPermissionState, string> = {
  granted: 'On',
  denied: 'Denied',
  undetermined: 'Off',
};

export default function SettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const snapshot = usePluginSnapshot();
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<TextInputInstance | null>(null);

  const aiConfigured = aiSettings ? isAiConfigured(aiSettings) : false;

  const groups = useMemo<SettingsGroupData[]>(
    () => [
      {
        title: 'General',
        items: [
          {
            id: 'appearance',
            group: 'General',
            title: 'Appearance',
            description: 'Theme, color mode and how ORBIT looks.',
            icon: Palette,
            href: '/settings/appearance' as Href,
            keywords: ['theme', 'dark', 'light', 'system', 'colors'],
          },
          {
            id: 'ai-connection',
            group: 'General',
            title: 'AI Connection',
            description: 'Provider, server URL, keys and connection test.',
            icon: Cloud,
            href: '/settings/ai-connection' as Href,
            value: aiConfigured ? 'Configured' : 'Not set',
            keywords: ['api', 'key', 'ollama', 'cloud', 'local', 'provider', 'server'],
          },
          {
            id: 'models',
            group: 'General',
            title: 'Model Preferences',
            description: 'Choose the model used for agent chat.',
            icon: Cpu,
            href: '/settings/models' as Href,
            value: aiSettings?.model || 'Not set',
            keywords: ['ollama', 'model', 'gpt', 'deepseek', 'gemini', 'claude'],
          },
          {
            id: 'memory',
            group: 'General',
            title: 'Memory',
            description: 'Notes each agent remembers across conversations.',
            icon: Brain,
            href: '/settings/memory' as Href,
            keywords: ['remember', 'context', 'agent', 'notes'],
          },
        ],
      },
      {
        title: 'Integrations',
        items: [
          {
            id: 'plugins',
            group: 'Integrations',
            title: 'Plugins',
            description: 'Install, enable and review plugin permissions.',
            icon: Puzzle,
            href: '/plugins' as Href,
            value: `${snapshot.stats.installed} installed`,
            keywords: ['extensions', 'marketplace', 'add-ons'],
          },
          {
            id: 'mcp',
            group: 'Integrations',
            title: 'MCP Servers',
            description: 'Connect external tool servers.',
            icon: Server,
            href: '/settings/mcp' as Href,
            keywords: ['model context protocol', 'tools', 'server', 'token'],
          },
          {
            id: 'connected-tools',
            group: 'Integrations',
            title: 'Connected Tools',
            description: 'Tool access, allowlists and saved grants.',
            icon: Wrench,
            href: '/tool-permissions' as Href,
            keywords: ['grants', 'allowlist', 'permissions', 'tools'],
          },
        ],
      },
      {
        title: 'Security',
        items: [
          {
            id: 'agent-permissions',
            group: 'Security',
            title: 'Agent Permissions',
            description: 'Active grants, pending approvals and emergency stop.',
            icon: ShieldCheck,
            href: '/permissions' as Href,
            keywords: ['approve', 'deny', 'grants', 'agents', 'stop'],
          },
          {
            id: 'approval-history',
            group: 'Security',
            title: 'Approval History',
            description: 'Past permission decisions and denials.',
            icon: History,
            href: '/permissions?tab=audit' as Href,
            keywords: ['audit', 'approved', 'denied', 'decisions', 'history'],
          },
          {
            id: 'connected-accounts',
            group: 'Security',
            title: 'Connected Accounts',
            description: 'Google and external service access.',
            icon: Link2,
            href: '/connections' as Href,
            keywords: ['google', 'oauth', 'sign in', 'accounts'],
          },
        ],
      },
      {
        title: 'Activity',
        items: [
          {
            id: 'activity-history',
            group: 'Activity',
            title: 'Activity History',
            description: 'Turns, tool calls and AI requests.',
            icon: Activity,
            href: '/events' as Href,
            keywords: ['events', 'log', 'tool calls', 'turns'],
          },
          {
            id: 'agent-execution-history',
            group: 'Activity',
            title: 'Agent Execution History',
            description: 'Completed, denied and failed agent actions.',
            icon: ListChecks,
            href: '/permissions?tab=activity' as Href,
            keywords: ['executions', 'runs', 'operations', 'denied', 'failed'],
          },
          {
            id: 'notifications',
            group: 'Activity',
            title: 'Notifications',
            description: 'Task reminders and test delivery.',
            icon: Bell,
            href: '/settings/notifications' as Href,
            value: PERMISSION_VALUES[permission],
            keywords: ['reminders', 'alerts', 'push', 'permission'],
          },
        ],
      },
      {
        title: 'Data',
        items: [
          {
            id: 'chat-history',
            group: 'Data',
            title: 'Chat History',
            description: 'Browse and delete agent conversations.',
            icon: MessagesSquare,
            href: '/conversations' as Href,
            keywords: ['chats', 'conversations', 'messages', 'delete'],
          },
          {
            id: 'data-management',
            group: 'Data',
            title: 'Data Management',
            description: 'Clear local chat data and review storage.',
            icon: Database,
            href: '/settings/data' as Href,
            keywords: ['storage', 'clear', 'delete', 'privacy', 'local'],
          },
        ],
      },
      {
        title: 'Account',
        items: [
          {
            id: 'account-details',
            group: 'Account',
            title: 'Account Details',
            description: 'Your local profile and session.',
            icon: UserRound,
            href: '/settings/account' as Href,
            keywords: ['profile', 'email', 'name', 'session'],
          },
          {
            id: 'sign-out',
            group: 'Account',
            title: 'Sign Out',
            description: 'End this session on the device.',
            icon: LogOut,
            action: 'signOut',
            destructive: true,
            keywords: ['logout', 'leave', 'account'],
          },
        ],
      },
    ],
    [aiConfigured, aiSettings?.model, permission, snapshot.stats.installed]
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const [nextSettings, nextPermission] = await Promise.all([
          loadAiSettings(),
          getNotificationPermission(),
        ]);

        if (active) {
          setAiSettings(nextSettings);
          setPermission(nextPermission);
        }
      })();

      return () => {
        active = false;
      };
    }, [])
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (query.length === 0 && !searchFocused) {
        return false;
      }

      if (query.length > 0) {
        setQuery('');
      } else {
        searchRef.current?.blur();
        setSearchFocused(false);
      }

      Keyboard.dismiss();
      return true;
    });

    return () => subscription.remove();
  }, [query, searchFocused]);

  if (!user) {
    return null;
  }

  const trimmedQuery = query.trim().toLowerCase();
  const results = trimmedQuery
    ? groups
        .flatMap((group) => group.items)
        .filter((entry) =>
          [entry.title, entry.description, entry.group, ...(entry.keywords ?? [])]
            .join(' ')
            .toLowerCase()
            .includes(trimmedQuery)
        )
    : [];

  function closeSearch() {
    Keyboard.dismiss();
    searchRef.current?.blur();
    setSearchFocused(false);
    setQuery('');
  }

  function openRoute(href: Href) {
    closeSearch();
    router.push(href);
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your local account stays on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  }

  function selectEntry(entry: SettingsEntry) {
    closeSearch();

    if (entry.action === 'signOut') {
      confirmSignOut();
      return;
    }

    if (entry.href) {
      router.push(entry.href);
    }
  }

  function showAbout() {
    Alert.alert(
      `ORBIT ${Constants.expoConfig?.version ?? '1.10.6'}`,
      'A local-first AI workspace.\n\nChats, tasks, permissions and account data stay on this device. AI requests go only to the provider you configure.',
      [
        {
          text: 'System status',
          onPress: () => router.push('/telemetry' as Href),
        },
        { text: 'Done', style: 'cancel' },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <SettingsHeader
        title="Settings"
        fallback={'/' as Href}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="About ORBIT"
            hitSlop={8}
            onPress={showAbout}
            style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          >
            <CircleHelp size={21} color={colors.text} strokeWidth={2} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior="padding"
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!trimmedQuery ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Account details for ${user.name}`}
                onPress={() => openRoute('/settings/account' as Href)}
                style={({ pressed }) => [
                  styles.profile,
                  pressed && styles.profilePressed,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsFor(user.name)}</Text>
                </View>
                <View style={styles.profileCopy}>
                  <Text numberOfLines={1} style={styles.profileName}>
                    {user.name}
                  </Text>
                  <Text numberOfLines={1} style={styles.profileEmail}>
                    {user.email}
                  </Text>
                </View>
                <View style={styles.localBadge}>
                  <Text style={styles.localBadgeText}>Local</Text>
                </View>
                <ChevronRight size={18} color={colors.textFaint} strokeWidth={2} />
              </Pressable>

              {groups.map((group) => (
                <SettingsGroup key={group.title} title={group.title}>
                  {group.items.map((entry) => (
                    <SettingsRow
                      key={entry.id}
                      icon={entry.icon}
                      title={entry.title}
                      description={entry.description}
                      value={entry.value}
                      destructive={entry.destructive}
                      showChevron={entry.action !== 'signOut'}
                      onPress={() => selectEntry(entry)}
                    />
                  ))}
                </SettingsGroup>
              ))}

              <Text style={styles.footer}>
                ORBIT v{Constants.expoConfig?.version ?? '1.10.6'} · local-first
              </Text>
            </>
          ) : results.length > 0 ? (
            <SettingsGroup title={`Results · ${results.length}`}>
              {results.map((entry) => (
                <SettingsRow
                  key={entry.id}
                  icon={entry.icon}
                  title={entry.title}
                  description={entry.description}
                  value={entry.group}
                  destructive={entry.destructive}
                  showChevron={entry.action !== 'signOut'}
                  onPress={() => selectEntry(entry)}
                />
              ))}
            </SettingsGroup>
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <SearchX size={24} color={colors.textMuted} strokeWidth={2} />
              </View>
              <Text accessibilityRole="header" style={styles.emptyTitle}>
                No settings found
              </Text>
              <Text style={styles.emptyText}>
                Try “theme”, “model”, “permissions”, or “notifications”.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear settings search"
                onPress={closeSearch}
                style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
              >
                <Text style={styles.clearButtonText}>Clear search</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        <SettingsSearch
          value={query}
          onChangeText={setQuery}
          inputRef={searchRef}
          bottomInset={insets.bottom}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    content: {
      flexGrow: 1,
      width: '100%',
      maxWidth: layout.contentMaxWidth,
      alignSelf: 'center',
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
      gap: spacing.lg,
    },
    headerButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIcon: {
      color: colors.text,
    },
    pressed: {
      opacity: 0.65,
    },
    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
    },
    profilePressed: {
      backgroundColor: colors.surfaceAlt,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    avatarText: {
      color: colors.accent,
      fontFamily: fonts.serif,
      fontSize: 19,
      fontWeight: '700',
    },
    profileCopy: {
      flex: 1,
      gap: 2,
    },
    profileName: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    profileEmail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    localBadge: {
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    localBadgeText: {
      color: colors.textMuted,
      ...typography.caption,
      fontSize: 11,
      fontWeight: '600',
    },
    chevron: {
      color: colors.textFaint,
    },
    footer: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
      gap: spacing.sm,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: spacing.xs,
    },
    emptyIconColor: {
      color: colors.textMuted,
    },
    emptyTitle: {
      color: colors.text,
      ...typography.section,
      textAlign: 'center',
    },
    emptyText: {
      color: colors.textMuted,
      ...typography.bodySmall,
      textAlign: 'center',
      maxWidth: 300,
    },
    clearButton: {
      marginTop: spacing.sm,
      minHeight: layout.touchTarget,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    clearButtonText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
  });
