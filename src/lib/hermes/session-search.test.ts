import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSqliteChatStore } from '../chat-store';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { formatSessionHits, normalizeSessionQuery, searchHermesSession } from './session-search';

vi.mock('../buddy/rewards', () => ({ rewardChatMessage: vi.fn(async () => undefined) }));

let db: TestDatabase;

afterEach(() => {
  db?.close();
});

describe('Hermes bounded session search', () => {
  it('scopes keyword recall to one conversation and redacts snippets', async () => {
    db = createTestDatabase();
    const store = createSqliteChatStore(db);
    const conversation = await store.createConversation(1, 'Search');
    const other = await store.createConversation(1, 'Other');

    await store.addMessage(1, conversation.id, 'user', 'Pay the electricity bill');
    await store.addMessage(
      1,
      conversation.id,
      'assistant',
      'API key sk-abcdefghijklmnop was shared for the bill'
    );
    await store.addMessage(1, other.id, 'user', 'Pay the electricity bill elsewhere');

    const hits = await searchHermesSession({
      store,
      userId: 1,
      conversationId: conversation.id,
      query: 'bill',
      limit: 10,
    });

    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.conversationId === conversation.id)).toBe(true);
    expect(hits.some((hit) => hit.snippet.includes('[key redacted]'))).toBe(true);
    expect(formatSessionHits(hits)).toContain('Relevant session history');
    expect(normalizeSessionQuery(' one   two three four five ')).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });
});
