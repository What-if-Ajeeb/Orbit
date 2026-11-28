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

/** Opens the system share sheet with the prepared artifact file. */
export async function shareArtifactFile(file: PreparedArtifactFile): Promise<void> {
  const Sharing = await import('expo-sharing');

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('File sharing is not available on this device.');
  }

  await Sharing.shareAsync(file.uri, {
    dialogTitle: `Share ${file.fileName}`,
    mimeType: file.mimeType,
  });
}
