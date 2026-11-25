import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Database, MessagesSquare, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useSession } from '@/context/auth';
import { getChatStore, type Conversation } from '@/lib/chat';

export default function DataSettingsScreen() {
  const db = useSQLiteContext();
  const { user } = useSession();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        setLoading(false);
        return;
      }

      let active = true;

      void (async () => {
        try {
          const next = await getChatStore(db).listConversations(user.id);

          if (active) {
            setConversations(next);
          }
        } catch (loadError) {
          if (active) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : 'Could not read local chat history.'
            );
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      })();

      return () => {
        active = false;
      };
    }, [db, user])
  );

  if (!user) {
    return null;
  }

  if (loading) {
    return <SettingsScreen title="Data Management" loading />;
  }

  const activeUser = user;
  const messageCount = conversations.reduce(
    (total, conversation) => total + conversation.messageCount,
    0
  );

  function confirmClearChat() {
    if (clearing) {
      return;
    }

    Alert.alert(
      'Clear chat history?',
      conversations.length > 0
        ? `This deletes ${conversations.length} conversation${
            conversations.length === 1 ? '' : 's'
          } and ${messageCount} message${
            messageCount === 1 ? '' : 's'
          } for ${activeUser.name}. Tasks and reminders are not affected.`
        : 'There are no conversations to clear. Tasks and reminders are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setClearing(true);
              setError(null);
              setNotice(null);

              try {
                await getChatStore(db).clearAllChat(activeUser.id);
                setConversations([]);
                setNotice('Chat history cleared. Tasks and reminders were kept.');
              } catch {
                setError('Could not clear chat history. Please try again.');
              } finally {
                setClearing(false);
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <SettingsScreen
      title="Data Management"
      subtitle="Review local chat data and remove it without touching your tasks or account."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <SettingsGroup
        title="Chat history"
        footer="Activity history, telemetry and permission audit records are separate and are not deleted here."
      >
        <SettingsRow
          icon={MessagesSquare}
          title="Conversations"
          description={`${conversations.length} conversation${
            conversations.length === 1 ? '' : 's'
          } · ${messageCount} message${messageCount === 1 ? '' : 's'}`}
          value="Review"
          onPress={() => router.push('/conversations' as Href)}
        />
        <SettingsRow
          icon={Trash2}
          title="Clear chat history"
          description="Delete every agent conversation for this account. This cannot be undone."
          value={clearing ? 'Clearing…' : 'Clear'}
          destructive
          showChevron={false}
          disabled={clearing}
          onPress={confirmClearChat}
        />
      </SettingsGroup>

      <SettingsGroup title="Local-first storage">
        <SettingsRow
          icon={Database}
          title="On-device data"
          description="Tasks, account details, permissions, AI settings and plugin data stay in the app database on this device."
          showChevron={false}
        />
      </SettingsGroup>
    </SettingsScreen>
  );
}
