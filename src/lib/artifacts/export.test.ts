import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  artifactExtension,
  artifactFileName,
  artifactMimeType,
  prepareArtifactExport,
  shareArtifactFile,
} from './export';

interface MockDir {
  segments: unknown[];
  exists: boolean;
  create(): void;
}

interface MockFile {
  segments: unknown[];
  exists: boolean;
  uri: string;
  content?: string;
  create(): void;
  delete(): void;
  write(content: string): Promise<void>;
}

const state = vi.hoisted(() => ({
  dirs: [] as MockDir[],
  files: [] as MockFile[],
  shareCalls: [] as unknown[][],
  available: true,
}));

vi.mock('expo-file-system', () => ({
  Paths: { cache: 'cache://' },
  Directory: class implements MockDir {
    segments: unknown[];
    exists = false;

    constructor(...segments: unknown[]) {
      this.segments = segments;
      state.dirs.push(this);
    }

    create() {
      this.exists = true;
    }
  },
  File: class implements MockFile {
    segments: unknown[];
    exists = false;
    uri = 'file://artifact-export';
    content?: string;

    constructor(...segments: unknown[]) {
      this.segments = segments;
      state.files.push(this);
    }

    create() {}

    delete() {}

    async write(content: string) {
      this.content = content;
    }
  },
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => state.available,
  shareAsync: async (...args: unknown[]) => {
    state.shareCalls.push(args);
  },
}));

describe('artifact file export', () => {
  beforeEach(() => {
    state.dirs.length = 0;
    state.files.length = 0;
    state.shareCalls.length = 0;
    state.available = true;
  });

  it('builds safe filenames and extensions from artifact metadata', () => {
    expect(artifactFileName('  My Plan / v2!  ', 'markdown', null)).toBe('My-Plan-v2.md');
    expect(artifactFileName('!!!', 'code', 'javascript')).toBe('orbit-artifact.js');
    expect(artifactExtension('code', 'Python')).toBe('py');
    expect(artifactMimeType('html', null)).toBe('text/html');
    expect(artifactMimeType('svg', null)).toBe('image/svg+xml');
    expect(artifactMimeType('code', 'json')).toBe('application/json');
  });

  it('writes the artifact into a cache subdirectory before sharing', async () => {
    const prepared = await prepareArtifactExport({
      title: 'Launch plan',
      type: 'code',
      language: 'python',
      content: 'print("hi")\n',
    });

    expect(state.dirs[0].segments).toEqual(['cache://', 'artifact-exports']);
    expect(state.files[0].content).toBe('print("hi")\n');
    expect(prepared.fileName).toBe('Launch-plan.py');
    expect(prepared.mimeType).toBe('text/x-python');
    expect(prepared.uri).toBe('file://artifact-export');
  });

  it('shares the file with a matching MIME type and dialog title', async () => {
    await shareArtifactFile({
      uri: 'file://plan.md',
      fileName: 'plan.md',
      mimeType: 'text/markdown',
    });

    expect(state.shareCalls[0]).toEqual([
      'file://plan.md',
      { dialogTitle: 'Share plan.md', mimeType: 'text/markdown' },
    ]);
  });

  it('fails clearly when the platform share sheet is unavailable', async () => {
    state.available = false;

    await expect(
      shareArtifactFile({ uri: 'file://plan.md', fileName: 'plan.md', mimeType: 'text/markdown' })
    ).rejects.toThrow('File sharing is not available');
  });
});
