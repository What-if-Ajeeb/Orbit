import { Platform } from 'react-native';

import type { Task } from './tasks';

export const REMINDER_CHANNEL_ID = 'reminders';

type NotificationsModule = typeof import('expo-notifications');

let handlerConfigured = false;

async function getNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  try {
    return await import('expo-notifications');
  } catch (error) {
    console.warn('Notifications are unavailable on this device.', error);
    return null;
  }
}

async function ensureChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Task reminders',
    description: 'Reminders for tasks you create in Orbit.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lightColor: '#D97757',
    sound: 'default',
  });
}

/** Registers the foreground handler and the Android channel. Safe to call repeatedly. */
export async function configureNotifications(): Promise<void> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return;
  }

  if (!handlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerConfigured = true;
  }

  try {
    await ensureChannel(Notifications);
  } catch (error) {
    console.warn('Could not create the reminder notification channel.', error);
  }
}

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

export async function getNotificationPermission(): Promise<NotificationPermissionState> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return 'denied';
  }

  try {
    const settings = await Notifications.getPermissionsAsync();

    if (settings.granted) {
      return 'granted';
    }

    return settings.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return false;
  }

  try {
    await ensureChannel(Notifications);
    const current = await Notifications.getPermissionsAsync();

    if (current.granted) {
      return true;
    }

    if (!current.canAskAgain) {
      return false;
    }

    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });

    return requested.granted;
  } catch (error) {
    console.warn('Could not request notification permission.', error);
    return false;
  }
}

/**
 * Schedules a local notification for a task. Uses `remind_at` when present,
 * otherwise `due_at`. Returns the OS notification id, or null when there is
 * nothing to schedule.
 */
export async function scheduleTaskReminder(task: Task): Promise<string | null> {
  if (task.status !== 'open') {
    return null;
  }

  const at = task.remindAt ?? task.dueAt;

  if (!at || at <= Date.now() + 30_000) {
    return null;
  }

  const Notifications = await getNotifications();

  if (!Notifications) {
    return null;
  }

  try {
    await ensureChannel(Notifications);

    const permission = await Notifications.getPermissionsAsync();

    if (!permission.granted) {
      return null;
    }

    return await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body: task.notes?.trim() || 'Orbit reminder',
        sound: 'default',
        data: { taskId: task.id, url: '/tasks' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(at),
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  } catch (error) {
    console.warn('Could not schedule the task reminder.', error);
    return null;
  }
}

export async function cancelTaskReminder(notificationId: string | null): Promise<void> {
  if (!notificationId) {
    return;
  }

  const Notifications = await getNotifications();

  if (!Notifications) {
    return;
  }

  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.warn('Could not cancel the scheduled reminder.', error);
  }
}

export async function sendTestReminder(): Promise<boolean> {
  const Notifications = await getNotifications();

  if (!Notifications) {
    return false;
  }

  const granted = await requestNotificationPermission();

  if (!granted) {
    return false;
  }

  try {
    await ensureChannel(Notifications);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Orbit is ready',
        body: 'This is what your task reminders will look like.',
        sound: 'default',
        data: { url: '/tasks' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
    return true;
  } catch (error) {
    console.warn('Could not send the test reminder.', error);
    return false;
  }
}
