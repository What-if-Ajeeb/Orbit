import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from '../permissions/redact';
import { MemoryStore, type MemoryEntry, type MemoryScope } from './store';

const MAX_SECTION_CHARS = 3_500;
const MAX_ENTRIES_PER_SCOPE = 4;

/** Scopes that are safe to load implicitly. Working memory is caller-supplied only. */
const DURABLE_SCOPES: MemoryScope[] = ['user', 'agent', 'long_term'];
const SESSION_SCOPES: MemoryScope[] = ['session', 'task_history'];

function formatEntries(label: string, entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => {
    const value = truncate(redactSecrets(entry.value.replace(/\s+/g, ' ')), 500);
    return `- [${entry.scope}:${entry.key}] ${value}`;
  });
  return `${label}:\n${lines.join('\n')}`;
}

/**
 * Builds a bounded memory block from the structured store. Only durable and
 * session-safe scopes are loaded implicitly. Project memories are included only
 * for the current project, and working memory is included only when the caller
 * explicitly passes it in. `excludeDurable` is used by the Hermes snapshot,
 * which owns the bounded user/agent sections.
 */
export async function buildMemoryPromptSection(
  db: SQLiteDatabase,
  userId: number,
  agentId: string,
  projectId: string | null | undefined,
  workingMemory: MemoryEntry[] = [],
  options: { excludeDurable?: boolean } = {}
): Promise<string> {
  try {
    const store = new MemoryStore(db);
    const recallScopes = (scopes: MemoryScope[]) =>
      options.excludeDurable
        ? Promise.resolve([] as MemoryEntry[])
        : Promise.all(
            scopes.map((scope) =>
              store.recall({ userId, agentId, scope, limit: MAX_ENTRIES_PER_SCOPE })
            )
          ).then((groups) => groups.flat());

    const [durable, session, project] = await Promise.all([
      recallScopes(DURABLE_SCOPES),
      recallScopes(SESSION_SCOPES),
      projectId
        ? store.recall({ userId, agentId, projectId, scope: 'project', limit: 6 })
        : Promise.resolve([] as MemoryEntry[]),
    ]);

    const section = [
      formatEntries('Persistent memory', durable),
      formatEntries('Session memory', session),
      formatEntries(`Project memory (${projectId ?? 'none'})`, project),
      formatEntries('Working memory (explicit)', workingMemory.slice(0, MAX_ENTRIES_PER_SCOPE)),
    ]
      .filter(Boolean)
      .join('\n\n');

    return section ? truncate(section, MAX_SECTION_CHARS) : '';
  } catch (error) {
    console.warn('Could not load structured memory for the prompt.', error);
    return '';
  }
}
