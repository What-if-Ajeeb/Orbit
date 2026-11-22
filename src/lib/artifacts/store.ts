import type { SQLiteDatabase } from 'expo-sqlite';

import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_TITLE_MAX,
  isArtifactType,
  newArtifactId,
  type Artifact,
  type ArtifactDetail,
  type ArtifactSummary,
  type ArtifactType,
  type ArtifactVersion,
} from './types';

type ArtifactRow = {
  id: string;
  user_id: number;
  conversation_id: number | null;
  title: string;
  type: string;
  language: string | null;
  current_version: number;
  created_at: number;
  updated_at: number;
  content?: string;
};

type VersionRow = {
  id: number;
  artifact_id: string;
  version: number;
  content: string;
  summary: string | null;
  created_at: number;
};

export type CreateArtifactInput = {
  title: string;
  type: ArtifactType;
  language?: string | null;
  content: string;
  conversationId?: number | null;
};

export type ArtifactEdit = { old: string; new: string };

const ARTIFACT_SELECT = `
  SELECT a.id, a.user_id, a.conversation_id, a.title, a.type, a.language,
    a.current_version, a.created_at, a.updated_at, v.content
  FROM artifacts a
  LEFT JOIN artifact_versions v
    ON v.artifact_id = a.id AND v.version = a.current_version
`;

const VERSION_SELECT = `
  SELECT id, artifact_id, version, content, summary, created_at
  FROM artifact_versions
`;

const VERSION_META_SELECT = `
  SELECT id, artifact_id, version, '' AS content, summary, created_at
  FROM artifact_versions
`;

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    title: row.title,
    type: row.type as ArtifactType,
    language: row.language,
    currentVersion: row.current_version,
    content: row.content ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: ArtifactRow): ArtifactSummary {
  const artifact = mapArtifact(row);
  return {
    id: artifact.id,
    userId: artifact.userId,
    conversationId: artifact.conversationId,
    title: artifact.title,
    type: artifact.type,
    language: artifact.language,
    currentVersion: artifact.currentVersion,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function mapVersion(row: VersionRow): ArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    content: row.content,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

/** Returns a trimmed title, or throws a message the model can act on. */
function validateTitle(raw: string): string {
  const title = typeof raw === 'string' ? raw.trim() : '';

  if (title.length > ARTIFACT_TITLE_MAX) {
    throw new Error(`The title can be at most ${ARTIFACT_TITLE_MAX} characters.`);
  }

  // An empty title would render as a blank, untappable card.
  return title || 'Untitled artifact';
}

function validateContent(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('content is required and must be a non-empty string.');
  }

  if (raw.length > ARTIFACT_CONTENT_MAX) {
    throw new Error(
      `The content is ${raw.length} characters; the limit is ${ARTIFACT_CONTENT_MAX}. Shorten it or split it into smaller artifacts.`
    );
  }

  return raw;
}

function validateType(raw: unknown): ArtifactType {
  if (!isArtifactType(raw)) {
    throw new Error('type must be one of: markdown, html, svg, code.');
  }

  return raw;
}

function validateLanguage(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }

  if (typeof raw !== 'string') {
    throw new Error('language must be a string.');
  }

  const language = raw.trim().slice(0, 40);
  return language || null;
}

/**
 * Exact-match replacement used by artifact_edit. Every `old` must occur
 * exactly once so a small change can never clobber the wrong text.
 */
export function applyExactEdits(content: string, rawEdits: unknown): string {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    throw new Error('edits must be a non-empty array of { old, new } pairs.');
  }

  let next = content;

  for (const item of rawEdits) {
    const edit = item as Partial<ArtifactEdit> | null;

    if (!edit || typeof edit.old !== 'string' || typeof edit.new !== 'string') {
      throw new Error('Each edit needs string `old` and `new` values.');
    }

    if (edit.old.length === 0) {
      throw new Error('An edit with an empty `old` string is not allowed.');
    }

    const first = next.indexOf(edit.old);

    if (first === -1) {
      const preview = edit.old.length > 60 ? `${edit.old.slice(0, 60)}…` : edit.old;
      throw new Error(`Could not find the exact text to replace: "${preview}"`);
    }

    if (next.indexOf(edit.old, first + 1) !== -1) {
      const preview = edit.old.length > 60 ? `${edit.old.slice(0, 60)}…` : edit.old;
      throw new Error(
        `The text "${preview}" appears more than once. Include more surrounding text so it matches exactly once.`
      );
    }

    next = next.slice(0, first) + edit.new + next.slice(first + edit.old.length);
  }

  return next;
}

/**
 * SQLite-backed artifact storage. Every read and write is scoped to a user;
 * version writes run in a transaction and prune old versions in the same
 * transaction so history can never be left half-written.
 */
export class ArtifactStore {
  constructor(private db: SQLiteDatabase) {}

  async create(userId: number, input: CreateArtifactInput): Promise<Artifact> {
    const title = validateTitle(input.title);
    const type = validateType(input.type);
    const language = validateLanguage(input.language);
    const content = validateContent(input.content);

    const now = Date.now();
    const id = newArtifactId();

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO artifacts (id, user_id, conversation_id, title, type, language,
           current_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        userId,
        input.conversationId ?? null,
        title,
        type,
        language,
        now,
        now
      );

      await this.db.runAsync(
        'INSERT INTO artifact_versions (artifact_id, version, content, created_at) VALUES (?, 1, ?, ?)',
        id,
        content,
        now
      );
    });

    const created = await this.get(userId, id);

    if (!created) {
      throw new Error('The artifact could not be saved.');
    }

    return created;
  }

  /** Replaces the content and records a new version, pruning old ones. */
  async addVersion(
    userId: number,
    id: string,
    content: unknown,
    summary?: unknown
  ): Promise<Artifact> {
    const nextContent = validateContent(content);
    const cleanSummary = typeof summary === 'string' && summary.trim() ? summary.trim().slice(0, 200) : null;

    const artifact = await this.get(userId, id);

    if (!artifact) {
      throw new Error('Artifact not found. It may have been deleted.');
    }

    const now = Date.now();
    const nextVersion = artifact.currentVersion + 1;

    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(
        `INSERT INTO artifact_versions (artifact_id, version, content, summary, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        id,
        nextVersion,
        nextContent,
        cleanSummary,
        now
      );

      await this.db.runAsync(
        'UPDATE artifacts SET current_version = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        nextVersion,
        now,
        id,
        userId
      );

      await this.db.runAsync(
        'DELETE FROM artifact_versions WHERE artifact_id = ? AND version <= ?',
        id,
        nextVersion - ARTIFACT_MAX_VERSIONS
      );
    });

    const updated = await this.get(userId, id);

    if (!updated) {
      throw new Error('The artifact could not be updated.');
    }

    return updated;
  }

  /** Applies exact-match replacements as a single new version. */
  async applyEdits(
    userId: number,
    id: string,
    edits: unknown,
    summary?: unknown
  ): Promise<Artifact> {
    const artifact = await this.get(userId, id);

    if (!artifact) {
      throw new Error('Artifact not found. It may have been deleted.');
    }

    const nextContent = applyExactEdits(artifact.content, edits);
    const editCount = Array.isArray(edits) ? edits.length : 0;
    const cleanSummary =
      typeof summary === 'string' && summary.trim()
        ? summary.trim().slice(0, 200)
        : `Edited (${editCount} change${editCount === 1 ? '' : 's'})`;

    return this.addVersion(userId, id, nextContent, cleanSummary);
  }

  /**
   * Loads an artifact with its current content and version history.
   * Version rows are metadata only — content loads lazily via getVersion, so
   * opening a 30-version artifact never pulls hundreds of kilobytes twice.
   */
  async get(userId: number, id: string): Promise<ArtifactDetail | null> {
    const row = await this.db.getFirstAsync<ArtifactRow>(
      `${ARTIFACT_SELECT} WHERE a.id = ? AND a.user_id = ?`,
      id,
      userId
    );

    if (!row) {
      return null;
    }

    const versionRows = await this.db.getAllAsync<VersionRow>(
      `${VERSION_META_SELECT} WHERE artifact_id = ? ORDER BY version DESC`,
      id
    );

    return { ...mapArtifact(row), versions: versionRows.map(mapVersion) };
  }

  /** Loads one version with its content, or null when it does not exist. */
  async getVersion(userId: number, id: string, version: number): Promise<ArtifactVersion | null> {
    const row = await this.db.getFirstAsync<VersionRow>(
      `${VERSION_SELECT} WHERE artifact_id = ? AND version = ?`,
      id,
      version
    );

    if (!row) {
      return null;
    }

    // The artifact must belong to this user before any content is returned.
    const owner = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = ? AND user_id = ?',
      id,
      userId
    );

    return owner ? mapVersion(row) : null;
  }

  /** Newest first; content is never loaded here. */
  async list(userId: number, limit = 200): Promise<ArtifactSummary[]> {
    const rows = await this.db.getAllAsync<ArtifactRow>(
      `SELECT a.id, a.user_id, a.conversation_id, a.title, a.type, a.language,
         a.current_version, a.created_at, a.updated_at
       FROM artifacts a
       WHERE a.user_id = ?
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT ?`,
      userId,
      Math.min(Math.max(limit, 1), 500)
    );

    return rows.map(mapSummary);
  }

  async remove(userId: number, id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM artifacts WHERE id = ? AND user_id = ?', id, userId);
  }

  /** Cheap existence check for chat cards. */
  async exists(userId: number, id: string): Promise<boolean> {
    const row = await this.db.getFirstAsync<{ id: string }>(
      'SELECT id FROM artifacts WHERE id = ? AND user_id = ?',
      id,
      userId
    );

    return row !== null;
  }

  /** Copies an old version's content into a new version. History is never rewritten. */
  async restoreVersion(userId: number, id: string, version: number): Promise<Artifact> {
    if (!Number.isInteger(version) || version < 1) {
      throw new Error('version must be a positive integer.');
    }

    const artifact = await this.get(userId, id);

    if (!artifact) {
      throw new Error('Artifact not found. It may have been deleted.');
    }

    if (version === artifact.currentVersion) {
      throw new Error(`Version ${version} is already the current version.`);
    }

    const target = await this.getVersion(userId, id, version);

    if (!target) {
      throw new Error(`Version ${version} no longer exists.`);
    }

    return this.addVersion(userId, id, target.content, `Restored from v${version}`);
  }
}
