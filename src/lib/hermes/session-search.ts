import type { ChatStore } from '../chat-store';
import { redactSecrets, truncate } from '../permissions/redact';

import type { HermesSessionHit } from './types';

const MAX_QUERY_CHARS = 80;
const MAX_TERMS = 4;
const MAX_SNIPPET_CHARS = 300;

/** Deterministic keyword normalisation; no embeddings or network calls. */
export function normalizeSessionQuery(query: string): string[] {
  return query
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_CHARS)
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

function countOccurrences(text: string, term: string): number {
  const needle = term.toLowerCase();
  let count = 0;
  let index = text.toLowerCase().indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.toLowerCase().indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Bounded SQLite session recall. Results are redacted, scored by exact term
 * frequency, and never summarised by a model.
 */
export async function searchHermesSession(input: {
  store: ChatStore;
  userId: number;
  conversationId: number;
  query: string;
  limit?: number;
}): Promise<HermesSessionHit[]> {
  const terms = normalizeSessionQuery(input.query);
  if (terms.length === 0) return [];

  const messages = await input.store.searchMessages(
    input.userId,
    input.conversationId,
    input.query,
    Math.min(Math.max(input.limit ?? 6, 1), 20)
  );

  return messages
    .map((message) => {
      const content = redactSecrets(message.content.replace(/\s+/g, ' ').trim());
      return {
        conversationId: input.conversationId,
        messageId: message.id,
        role: message.role,
        snippet: truncate(content, MAX_SNIPPET_CHARS),
        createdAt: message.createdAt ?? null,
        score: terms.reduce((sum, term) => sum + countOccurrences(content, term), 0),
      };
    })
    .filter((hit) => hit.score > 0 && hit.snippet.length > 0)
    .sort((left, right) => right.score - left.score || right.messageId - left.messageId);
}

/** Prompt text with a hard character ceiling so recall cannot flood context. */
export function formatSessionHits(hits: HermesSessionHit[], maxChars = 1_200): string {
  if (hits.length === 0) return '';

  const lines: string[] = [];
  let used = 0;
  for (const hit of hits) {
    const line = `- [${hit.role}:${hit.messageId}] ${hit.snippet}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 0 ? `Relevant session history (keyword recall):\n${lines.join('\n')}` : '';
}
