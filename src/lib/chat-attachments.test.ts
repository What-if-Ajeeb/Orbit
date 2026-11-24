import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  pickDocuments,
  pickImages,
  toChatAttachments,
  toLlmAttachments,
} from './chat-attachments';

const mocks = vi.hoisted(() => ({
  imageResult: { canceled: false, assets: [] as Record<string, unknown>[] },
  documentResult: { canceled: false, assets: [] as Record<string, unknown>[] },
  documentText: 'api_key=secret-value\nMeeting notes',
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(async () => mocks.imageResult),
}));

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(async () => mocks.documentResult),
}));

vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public uri: string) {}

    async text(): Promise<string> {
      return mocks.documentText;
    }
  },
}));

describe('chat attachments', () => {
  beforeEach(() => {
    mocks.imageResult = { canceled: false, assets: [] };
    mocks.documentResult = { canceled: false, assets: [] };
    mocks.documentText = 'api_key=secret-value\nMeeting notes';
    vi.clearAllMocks();
  });

  it('reads picked images as base64 with safe metadata', async () => {
    mocks.imageResult.assets = [
      {
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
        base64: 'abc123',
      },
    ];

    const picked = await pickImages();

    expect(picked[0]).toMatchObject({
      id: 'att_uuid-1',
      name: 'photo.jpg',
      kind: 'image',
      mimeType: 'image/jpeg',
      data: 'abc123',
    });
  });

  it('rejects oversized images instead of sending them to a model', async () => {
    mocks.imageResult.assets = [
      {
        uri: 'file:///huge.jpg',
        fileName: 'huge.jpg',
        mimeType: 'image/jpeg',
        fileSize: 9 * 1024 * 1024,
        base64: 'abc123',
      },
    ];

    await expect(pickImages()).rejects.toThrow(/too large/);
  });

  it('extracts redacted text previews from small documents', async () => {
    mocks.documentResult.assets = [
      {
        uri: 'file:///notes.txt',
        name: 'notes.txt',
        mimeType: 'text/plain',
        size: 40,
      },
    ];

    const picked = await pickDocuments();

    expect(picked[0].kind).toBe('document');
    expect(picked[0].textPreview).toContain('Meeting notes');
    expect(picked[0].textPreview).not.toContain('secret-value');
  });

  it('separates stored metadata from the in-memory model payload', async () => {
    mocks.imageResult.assets = [
      {
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 10,
        base64: 'abc123',
      },
    ];

    const picked = await pickImages();
    const stored = toChatAttachments(picked);
    const llm = toLlmAttachments(picked);

    expect(stored[0]).not.toHaveProperty('data');
    expect(llm[0]).toMatchObject({ name: 'photo.jpg', data: 'abc123' });
  });
});
