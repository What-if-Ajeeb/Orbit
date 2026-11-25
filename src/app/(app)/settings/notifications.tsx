import { useFocusEffect } from 'expo-router';
import { Bell, BellRing, Settings, ShieldCheck } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendTestReminder,
  type NotificationPermissionState,
} from '@/lib/notifications';
import { spacing, typography } from '@/theme';

const STATUS_LABEL: Record<NotificationPermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked',
  undetermined: 'Not set',
};

function statusDescription(permission: NotificationPermissionState): string {
  if (permission === 'granted') {
    return 'Task reminders are allowed and scheduled locally.';
  }

  if (permission === 'denied') {
    return 'Blocked in system settings. Allow notifications for ORBIT there.';
  }

  return 'Allow ORBIT to remind you before a task is due.';
}

export default function NotificationsSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const next = await getNotificationPermission();

        if (active) {
          setPermission(next);
          setLoading(false);
        }
      })();

      return () => {
        active = false;
      };
    }, [])
  );

  if (loading) {
    return <SettingsScreen title="Notifications" loading />;
  }

  async function enableNotifications() {
    if (permission === 'denied') {
      setError('Notifications are blocked in system settings. Open system settings to allow them.');
      return;
    }

    setError(null);
    setNotice(null);
    const granted = await requestNotificationPermission();
    const nextPermission = await getNotificationPermission();
    setPermission(nextPermission);

    if (granted) {
      setNotice('Notifications enabled. You will be reminded 15 minutes before a task is due.');
    } else {
      setError('Notifications are not allowed. Enable them in system settings.');
    }
  }

  async function testReminder() {
    if (testing) {
      return;
    }

    setTesting(true);
    setError(null);
    setNotice(null);
    const sent = await sendTestReminder();
    setPermission(await getNotificationPermission());
    setTesting(false);

    if (sent) {
      setNotice('Test reminder scheduled. It should arrive in about 3 seconds.');
    } else {
      setError('Could not send a test reminder. Check notification permission.');
    }
  }

  return (
    <SettingsScreen
      title="Notifications"
      subtitle="Task reminders are scheduled on this device. ORBIT does not send notification data to a server."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <SettingsGroup
        title="Reminders"
        footer="Reminder timing comes from a task's reminder or due date. Only open tasks are scheduled."
      >
        <SettingsRow
          icon={Bell}
          title="Task reminders"
          description={statusDescription(permission)}
          value={STATUS_LABEL[permission]}
          role="switch"
          checked={permission === 'granted'}
          showChevron={false}
          onPress={() => {
            if (permission !== 'granted') {
              void enableNotifications();
            }
          }}
          right={
            <View pointerEvents="none">
              <Switch
                value={permission === 'granted'}
                trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
                thumbColor={permission === 'granted' ? colors.accent : colors.textFaint}
                ios_backgroundColor={colors.surfaceAlt}
                accessibilityLabel="Task reminders"
              />
            </View>
          }
        />

        {permission === 'granted' ? (
          <SettingsRow
            icon={BellRing}
            title="Send test reminder"
            description="Schedule a sample notification in about 3 seconds."
            value={testing ? 'Sending…' : 'Send'}
            showChevron={false}
            disabled={testing}
            onPress={() => {
              void testReminder();
            }}
          />
        ) : null}

        {permission === 'denied' ? (
          <SettingsRow
            icon={Settings}
            title="Open system settings"
            description="Allow notifications for ORBIT in the Android or iOS settings."
            showChevron={false}
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        ) : null}
      </SettingsGroup>

      <View style={styles.noteRow}>
        <ShieldCheck size={16} color={colors.textFaint} strokeWidth={2} />
        <Text style={styles.note}>
          The app asks for notification access only when you enable reminders or send a test.
        </Text>
      </View>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    noteRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    note: {
      flex: 1,
      color: colors.textFaint,
      ...typography.caption,
    },
  });
