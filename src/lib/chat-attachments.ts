import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { LlmAttachment } from './ai/types';
import type { ChatAttachment } from './chat';
import { redactSecrets } from './permissions/redact';

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_CHARS = 12_000;

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
]);

/** Stored metadata plus the in-memory payload sent to the model this turn. */
export type PickedAttachment = ChatAttachment & {
  data?: string;
};

function safeName(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').split(/[\r\n]/)[0].trim().slice(0, 120);
  return clean || fallback;
}

function safeMime(value: string | null | undefined, fallback: string): string {
  return (value ?? '').split(';')[0].trim().toLowerCase() || fallback;
}

function limit(items: PickedAttachment[]): PickedAttachment[] {
  return items.slice(0, MAX_ATTACHMENTS);
}

export async function pickImages(): Promise<PickedAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    allowsMultipleSelection: true,
    selectionLimit: MAX_ATTACHMENTS,
    quality: 0.7,
    base64: true,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  const picked: PickedAttachment[] = [];

  for (const asset of result.assets) {
    if (picked.length >= MAX_ATTACHMENTS) {
      break;
    }

    const size = typeof asset.fileSize === 'number' ? asset.fileSize : null;

    if (size !== null && size > MAX_IMAGE_BYTES) {
      throw new Error(`“${safeName(asset.fileName, 'Image')}” is too large. Use an image under 8 MB.`);
    }

    const data = asset.base64 ?? '';

    if (!data) {
      throw new Error('That image could not be read. Please choose it again.');
    }

    picked.push({
      id: `att_${Crypto.randomUUID()}`,
      name: safeName(asset.fileName, 'Image'),
      kind: 'image',
      mimeType: safeMime(asset.mimeType, 'image/jpeg'),
      uri: asset.uri,
      size,
      data,
    });
  }

  return picked;
}

export async function pickDocuments(): Promise<PickedAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/pdf',
      'text/html',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  const picked: PickedAttachment[] = [];

  for (const asset of result.assets.slice(0, MAX_ATTACHMENTS)) {
    const size = typeof asset.size === 'number' ? asset.size : null;

    if (size !== null && size > MAX_DOCUMENT_BYTES) {
      throw new Error(`“${safeName(asset.name, 'Document')}” is too large. Use a file under 2 MB.`);
    }

    const mimeType = safeMime(asset.mimeType, 'text/plain');
    const isText = TEXT_MIME_TYPES.has(mimeType);
    let data: string | undefined;

    if (isText) {
      try {
        data = redactSecrets(await new File(asset.uri).text()).slice(0, MAX_PREVIEW_CHARS);
      } catch {
        throw new Error('That document could not be read. Please choose a plain text file.');
      }
    }

    picked.push({
      id: `att_${Crypto.randomUUID()}`,
      name: safeName(asset.name, 'Document'),
      kind: 'document',
      mimeType,
      uri: asset.uri,
      size,
      ...(data ? { textPreview: data } : {}),
      ...(data ? { data } : {}),
    });
  }

  return picked;
}

export function toChatAttachments(items: PickedAttachment[]): ChatAttachment[] {
  return limit(items).map(({ data: _data, ...meta }) => meta);
}

export function toLlmAttachments(items: PickedAttachment[]): LlmAttachment[] {
  return limit(items)
    .filter((item) => Boolean(item.data))
    .map((item) => ({
      name: item.name,
      kind: item.kind,
      mimeType: item.mimeType,
      data: item.data as string,
    }));
}
