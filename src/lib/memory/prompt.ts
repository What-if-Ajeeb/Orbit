import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets, truncate } from '../permissions/redact';
import { MemoryStore, type MemoryEntry } from './store';

const MAX_SECTION_CHARS = 3_500;

function formatEntries(label: string, entries: MemoryEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => {
    const value = truncate(redactSecrets(entry.value.replace(/\s+/g, ' ')), 500);
    return `- [${entry.scope}:${entry.key}] ${value}`;
  });
  return `${label}:\n${lines.join('\n')}`;
}

/**
 * Builds a bounded memory block from the structured store. Project memories are
 * included only for the current project scope, so one workspace never leaks
 * into another.
 */
export async function buildMemoryPromptSection(
  db: SQLiteDatabase,
  userId: number,
  agentId: string,
  projectId: string | null | undefined
): Promise<string> {
  try {
    const store = new MemoryStore(db);
    const [general, project] = await Promise.all([
      store.recall({ userId, agentId, limit: 10 }),
      projectId
        ? store.recall({ userId, agentId, projectId, scope: 'project', limit: 6 })
        : Promise.resolve([] as MemoryEntry[]),
    ]);

    const section = [
      formatEntries('Persistent memory', general),
      formatEntries(`Project memory (${projectId ?? 'none'})`, project),
    ]
      .filter(Boolean)
      .join('\n\n');

    return section ? truncate(section, MAX_SECTION_CHARS) : '';
  } catch (error) {
    console.warn('Could not load structured memory for the prompt.', error);
    return '';
  }
}
