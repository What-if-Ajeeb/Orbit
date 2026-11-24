import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ToolStatusList } from '@/components/ToolStatusList';
import { useSession } from '@/context/auth';
import { ArtifactStore } from '@/lib/artifacts/store';
import { artifactTypeLabel, type ArtifactRef, type ArtifactType } from '@/lib/artifacts/types';
import type { ChatAttachment, ChatMessage } from '@/lib/chat';
import { radius, spacing } from '@/theme';

const TYPE_ICONS: Record<ArtifactType, keyof typeof Ionicons.glyphMap> = {
  markdown: 'document-text-outline',
  html: 'globe-outline',
  svg: 'image-outline',
  code: 'code-slash-outline',
};

type ArtifactCardProps = {
  artifact: ArtifactRef;
};

/** One tappable card per artifact under the assistant reply. */
function ArtifactCard({ artifact }: ArtifactCardProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const { user } = useSession();
  const [exists, setExists] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const found = await new ArtifactStore(db).exists(user.id, artifact.id);

        if (!cancelled) {
          setExists(found);
        }
      } catch {
        if (!cancelled) {
          setExists(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifact.id, db, user]);

  const label = artifactTypeLabel(artifact.type);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        exists
          ? `Open artifact ${artifact.title}, ${label} version ${artifact.version}`
          : `Artifact ${artifact.title} was deleted`
      }
      disabled={!exists}
      onPress={() =>
        router.push({ pathname: '/artifact', params: { id: artifact.id } })
      }
      style={({ pressed }) => [styles.card, pressed && exists && styles.cardPressed]}
    >
      <View style={styles.cardIcon}>
        <Ionicons
          name={exists ? TYPE_ICONS[artifact.type] : 'trash-outline'}
          size={20}
          color={exists ? colors.accent : colors.textFaint}
        />
      </View>
      <View style={styles.cardText}>
        <Text numberOfLines={1} style={styles.cardTitle}>
          {artifact.title}
        </Text>
        <Text style={[styles.cardSubtitle, !exists && styles.cardDeleted]}>
          {exists ? `${label} · v${artifact.version}` : 'Deleted'}
        </Text>
      </View>
      {exists ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
};

function AttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.attachmentCard}>
      {attachment.kind === 'image' ? (
        <Image resizeMode="cover" source={{ uri: attachment.uri }} style={styles.attachmentThumb} />
      ) : (
        <View style={styles.attachmentIcon}>
          <Ionicons name="document-text-outline" size={18} color={colors.accent} />
        </View>
      )}
      <View style={styles.attachmentCopy}>
        <Text numberOfLines={1} style={styles.attachmentName}>
          {attachment.name}
        </Text>
        <Text style={styles.attachmentMeta}>
          {attachment.kind === 'image' ? 'Image' : attachment.mimeType}
        </Text>
      </View>
    </View>
  );
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const isUser = message.role === 'user';
  const attachments = message.attachments ?? [];
  const toolEvents = message.toolEvents ?? [];

  return (
    <View style={[styles.wrap, isUser ? styles.wrapUser : styles.wrapAssistant]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser && styles.userText]}>{message.content}</Text>
      </View>

      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((attachment) => (
            <AttachmentCard key={attachment.id} attachment={attachment} />
          ))}
        </View>
      ) : null}

      {message.artifacts.length > 0 ? (
        <View style={styles.artifacts}>
          {message.artifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} />
          ))}
        </View>
      ) : null}

      {message.traces.length > 0 ? (
        <View style={styles.traces}>
          {message.traces.map((trace, index) => (
            <View key={`${trace}-${index}`} style={styles.traceRow}>
              <Ionicons name="checkmark-circle" size={12} color={colors.success} />
              <Text style={styles.traceText}>{trace}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <ToolStatusList events={toolEvents} />
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
  wrap: {
    maxWidth: '92%',
    gap: 5,
  },
  wrapUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  wrapAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 2,
  },
  agentLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  bubble: {},
  userBubble: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // Assistant replies are plain text on the page, like a document — no bubble.
  assistantBubble: {
    paddingVertical: 2,
  },
  text: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  userText: {
    color: colors.text,
  },
  attachments: {
    gap: 6,
    paddingTop: 4,
    alignSelf: 'stretch',
  },
  artifacts: {
    gap: 6,
    paddingTop: 4,
    alignSelf: 'stretch',
  },
  attachmentCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    maxWidth: 320,
  },
  attachmentThumb: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  attachmentIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentCopy: {
    flex: 1,
    gap: 2,
  },
  attachmentName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  attachmentMeta: {
    color: colors.textMuted,
    fontSize: 11,
  },
  card: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: 360,
  },
  cardPressed: {
    opacity: 0.75,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  cardDeleted: {
    color: colors.danger,
  },
  traces: {
    gap: 4,
    paddingLeft: 2,
  },
  traceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  traceText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  });
