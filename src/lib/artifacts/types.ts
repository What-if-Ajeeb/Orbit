export type ArtifactType = 'markdown' | 'html' | 'svg' | 'code';

/** Lightweight reference stored in a chat message's meta. */
export type ArtifactRef = {
  id: string;
  title: string;
  type: ArtifactType;
  version: number;
};

export type Artifact = {
  id: string;
  userId: number;
  conversationId: number | null;
  title: string;
  type: ArtifactType;
  language: string | null;
  currentVersion: number;
  /** Current version's content. Not loaded by list queries. */
  content: string;
  createdAt: number;
  updatedAt: number;
};

/** Row shape for list queries, which never load content. */
export type ArtifactSummary = Omit<Artifact, 'content'>;

export type ArtifactVersion = {
  id: number;
  artifactId: string;
  version: number;
  content: string;
  summary: string | null;
  createdAt: number;
};

export type ArtifactDetail = Artifact & { versions: ArtifactVersion[] };

/** Title limit in characters. */
export const ARTIFACT_TITLE_MAX = 80;
/** Content limit in characters. */
export const ARTIFACT_CONTENT_MAX = 200_000;
/** Newest versions kept per artifact; older ones are pruned. */
export const ARTIFACT_MAX_VERSIONS = 30;
/** Maximum characters in one window.orbit.storage key. */
export const ARTIFACT_KV_KEY_MAX_CHARS = 200;
/** Maximum characters in one window.orbit.storage value (~1 MB). */
export const ARTIFACT_KV_VALUE_MAX_CHARS = 1_000_000;
/** Maximum combined characters across all keys of one artifact (~5 MB). */
export const ARTIFACT_KV_TOTAL_MAX_CHARS = 5_000_000;

const ARTIFACT_TYPES: ArtifactType[] = ['markdown', 'html', 'svg', 'code'];

export function isArtifactType(value: unknown): value is ArtifactType {
  return typeof value === 'string' && (ARTIFACT_TYPES as string[]).includes(value);
}

/** Human label used by cards, chips, and the viewer. */
export function artifactTypeLabel(type: ArtifactType): string {
  switch (type) {
    case 'markdown':
      return 'Document';
    case 'html':
      return 'Page';
    case 'svg':
      return 'Graphic';
    case 'code':
      return 'Code';
  }
}

/** Filter chip groups used by the library screen. */
export type ArtifactFilter = 'all' | 'markdown' | 'html' | 'svg' | 'code';

/** "art_" plus a short random base36 string. */
export function newArtifactId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `art_${Date.now().toString(36)}${random}`;
}
