import type { ArtifactType } from './types';

/**
 * Helpers for exporting an artifact as a real file. Native modules are loaded
 * only inside the async functions, so importing this module cannot affect the
 * app startup path or tests.
 */

export type ArtifactExportInput = {
  title: string;
  type: ArtifactType;
  language: string | null;
  content: string;
};

export type PreparedArtifactFile = {
  uri: string;
  fileName: string;
  mimeType: string;
};

const EXTENSION_BY_TYPE: Record<ArtifactType, string> = {
  markdown: 'md',
  html: 'html',
  svg: 'svg',
  code: 'txt',
};

const EXTENSION_BY_LANGUAGE: Record<string, string> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'js',
  js: 'js',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'kt',
  kt: 'kt',
  markdown: 'md',
  md: 'md',
  php: 'php',
  python: 'py',
  py: 'py',
  ruby: 'rb',
  rust: 'rs',
  shell: 'sh',
  sh: 'sh',
  sql: 'sql',
  swift: 'swift',
  ts: 'ts',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yml',
  yml: 'yml',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  c: 'text/x-c',
  cpp: 'text/x-c++src',
  cs: 'text/plain',
  css: 'text/css',
  go: 'text/plain',
  html: 'text/html',
  java: 'text/x-java-source',
  js: 'text/javascript',
  json: 'application/json',
  jsx: 'text/javascript',
  kt: 'text/plain',
  md: 'text/markdown',
  php: 'text/x-php',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  rs: 'text/plain',
  sh: 'text/x-shellscript',
  sql: 'application/sql',
  swift: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  txt: 'text/plain',
  xml: 'application/xml',
  yml: 'text/yaml',
};

export function artifactExtension(type: ArtifactType, language: string | null): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  return (normalized && EXTENSION_BY_LANGUAGE[normalized]) || EXTENSION_BY_TYPE[type];
}

export function artifactFileName(title: string, type: ArtifactType, language: string | null): string {
  const base =
    title
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'orbit-artifact';

  return `${base}.${artifactExtension(type, language)}`;
}

export function artifactMimeType(type: ArtifactType, language: string | null): string {
  if (type === 'html') {
    return 'text/html';
  }
  if (type === 'svg') {
    return 'image/svg+xml';
  }

  const extension = artifactExtension(type, language);
  return MIME_BY_EXTENSION[extension] ?? (type === 'markdown' ? 'text/markdown' : 'text/plain');
}

/** Writes the artifact into the app cache so it can be shared as a file. */
export async function prepareArtifactExport(
  input: ArtifactExportInput
): Promise<PreparedArtifactFile> {
  const { Directory, File, Paths } = await import('expo-file-system');
  const directory = new Directory(Paths.cache, 'artifact-exports');

  if (!directory.exists) {
    directory.create();
  }

  const fileName = artifactFileName(input.title, input.type, input.language);
  const file = new File(directory, fileName);

  if (file.exists) {
    file.delete();
  }
  file.create();
  await file.write(input.content);

  return {
    uri: file.uri,
    fileName,
    mimeType: artifactMimeType(input.type, input.language),
  };
}

/** React Native's Android share module accepts `type` for the streamed file. */
type NativeShareContent = {
  url: string;
  message: string;
  title: string;
  /** Consumed by ShareModule on Android; ignored by the public TypeScript API. */
  type?: string;
};

/**
 * Opens the system share sheet with the prepared artifact file. `expo-sharing`
 * is intentionally not used: the existing `expo-file-system` + React Native
 * Share path keeps the Android native module graph unchanged while still
 * sharing a real file (not pasted text).
 */
export async function shareArtifactFile(file: PreparedArtifactFile): Promise<void> {
  const { Share } = await import('react-native');

  let shareUri = file.uri;
  if (shareUri.startsWith('file://')) {
    try {
      // Android exposes app-private files to other apps through a content URI.
      const { getContentUriAsync } = await import('expo-file-system/legacy');
      shareUri = await getContentUriAsync(shareUri);
    } catch {
      // iOS and other platforms can share the file URI directly.
    }
  }

  const content: NativeShareContent = {
    url: shareUri,
    message: file.fileName,
    title: `Share ${file.fileName}`,
    type: file.mimeType,
  };

  await Share.share(content, { dialogTitle: `Share ${file.fileName}` });
}
