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
  LayoutGrid,
  Link2,
  ListChecks,
  LogOut,
  MessagesSquare,
  Palette,
  Puzzle,
  Server,
  ShieldCheck,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsHeader } from '@/components/settings/SettingsHeader';
import { SettingsRow } from '@/components/settings/SettingsRow';
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
  title: string;
  description: string;
  icon: LucideIcon;
  href?: Href;
  action?: 'signOut';
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
  const { user, signOut } = useSession();
  const snapshot = usePluginSnapshot();
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');

  const aiConfigured = aiSettings ? isAiConfigured(aiSettings) : false;

  const groups = useMemo<SettingsGroupData[]>(
    () => [
      {
        title: 'General',
        items: [
          {
            id: 'appearance',
            title: 'Appearance',
            description: 'Theme, color mode and how ORBIT looks.',
            icon: Palette,
            href: '/settings/appearance' as Href,
          },
          {
            id: 'ai-connection',
            title: 'AI Connection',
            description: 'Provider, server URL, keys and connection test.',
            icon: Cloud,
            href: '/settings/ai-connection' as Href,
            value: aiConfigured ? 'Configured' : 'Not set',
          },
          {
            id: 'models',
            title: 'Model Preferences',
            description: 'Choose the model used for agent chat.',
            icon: Cpu,
            href: '/settings/models' as Href,
            value: aiSettings?.model || 'Not set',
          },
          {
            id: 'memory',
            title: 'Memory',
            description: 'Notes each agent remembers across conversations.',
            icon: Brain,
            href: '/settings/memory' as Href,
          },
          {
            id: 'navigation',
            title: 'Navigation',
            description: 'Choose and reorder the three bottom navigation slots.',
            icon: LayoutGrid,
            href: '/settings/navigation' as Href,
            value: '3 slots',
          },
        ],
      },
      {
        title: 'Integrations',
        items: [
          {
            id: 'plugins',
            title: 'Plugins',
            description: 'Install, enable and review plugin permissions.',
            icon: Puzzle,
            href: '/plugins' as Href,
            value: `${snapshot.stats.installed} installed`,
          },
          {
            id: 'mcp',
            title: 'MCP Servers',
            description: 'Connect external tool servers.',
            icon: Server,
            href: '/settings/mcp' as Href,
          },
          {
            id: 'connected-tools',
            title: 'Connected Tools',
            description: 'Tool access, allowlists and saved grants.',
            icon: Wrench,
            href: '/tool-permissions' as Href,
          },
        ],
      },
      {
        title: 'Security',
        items: [
          {
            id: 'agent-permissions',
            title: 'Agent Permissions',
            description: 'Active grants, pending approvals and emergency stop.',
            icon: ShieldCheck,
            href: '/permissions' as Href,
          },
          {
            id: 'approval-history',
            title: 'Approval History',
            description: 'Past permission decisions and denials.',
            icon: History,
            href: '/permissions?tab=audit' as Href,
          },
          {
            id: 'connected-accounts',
            title: 'Connected Accounts',
            description: 'Google and external service access.',
            icon: Link2,
            href: '/connections' as Href,
          },
        ],
      },
      {
        title: 'Activity',
        items: [
          {
            id: 'activity-history',
            title: 'Activity History',
            description: 'Turns, tool calls and AI requests.',
            icon: Activity,
            href: '/events' as Href,
          },
          {
            id: 'agent-execution-history',
            title: 'Agent Execution History',
            description: 'Completed, denied and failed agent actions.',
            icon: ListChecks,
            href: '/permissions?tab=activity' as Href,
          },
          {
            id: 'notifications',
            title: 'Notifications',
            description: 'Task reminders and test delivery.',
            icon: Bell,
            href: '/settings/notifications' as Href,
            value: PERMISSION_VALUES[permission],
          },
        ],
      },
      {
        title: 'Data',
        items: [
          {
            id: 'chat-history',
            title: 'Chat History',
            description: 'Browse and delete agent conversations.',
            icon: MessagesSquare,
            href: '/conversations' as Href,
          },
          {
            id: 'data-management',
            title: 'Data Management',
            description: 'Clear local chat data and review storage.',
            icon: Database,
            href: '/settings/data' as Href,
          },
        ],
      },
      {
        title: 'Account',
        items: [
          {
            id: 'account-details',
            title: 'Account Details',
            description: 'Your local profile and session.',
            icon: UserRound,
            href: '/settings/account' as Href,
          },
          {
            id: 'sign-out',
            title: 'Sign Out',
            description: 'End this session on the device.',
            icon: LogOut,
            action: 'signOut',
            destructive: true,
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

  if (!user) {
    return null;
  }

  function openRoute(href: Href) {
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
        menu
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

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Account details for ${user.name}`}
          onPress={() => openRoute('/settings/account' as Href)}
          style={({ pressed }) => [styles.profile, pressed && styles.profilePressed]}
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
      </ScrollView>
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
    footer: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
    },
  });
