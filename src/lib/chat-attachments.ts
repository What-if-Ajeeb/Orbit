import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';

import type { LlmAttachment } from './ai/types';
import type { ChatAttachment } from './chat';
import { redactSecrets } from './permissions/redact';

export const MAX_ATTACHMENTS = 4;
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

/** `application/octet-stream` is tolerated when Android omits a precise MIME type. */
export const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  ...TEXT_MIME_TYPES,
  'application/pdf',
  'application/octet-stream',
]);

const DOCUMENT_PICKER_TYPES = [
  ...TEXT_MIME_TYPES,
  'application/pdf',
];

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

function imageAttachment(asset: ImagePicker.ImagePickerAsset): PickedAttachment {
  const size = typeof asset.fileSize === 'number' ? asset.fileSize : null;

  if (size !== null && size > MAX_IMAGE_BYTES) {
    throw new Error(`“${safeName(asset.fileName, 'Image')}” is too large. Use an image under 8 MB.`);
  }

  const data = asset.base64 ?? '';

  if (!data) {
    throw new Error('That image could not be read. Please choose it again.');
  }

  return {
    id: `att_${Crypto.randomUUID()}`,
    name: safeName(asset.fileName, 'Image'),
    kind: 'image',
    mimeType: safeMime(asset.mimeType, 'image/jpeg'),
    uri: asset.uri,
    size,
    data,
  };
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

    picked.push(imageAttachment(asset));
  }

  return picked;
}

export async function pickCamera(): Promise<PickedAttachment[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();

  if (!permission.granted) {
    throw new Error('Camera permission is required to take a photo.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 0.7,
    base64: true,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  return [imageAttachment(result.assets[0])];
}

export async function pickDocuments(): Promise<PickedAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: DOCUMENT_PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: true,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  const picked: PickedAttachment[] = [];

  for (const asset of result.assets.slice(0, MAX_ATTACHMENTS)) {
    const name = safeName(asset.name, 'Document');
    const size = typeof asset.size === 'number' ? asset.size : null;
    const mimeType = safeMime(asset.mimeType, 'text/plain');

    if (asset.mimeType && !SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType)) {
      throw new Error(`“${name}” uses an unsupported format. Choose a text, JSON, HTML or PDF file.`);
    }

    if (size !== null && size > MAX_DOCUMENT_BYTES) {
      throw new Error(`“${name}” is too large. Use a file under 2 MB.`);
    }

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
      name,
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

function isSameAttachment(a: PickedAttachment, b: PickedAttachment): boolean {
  if (a.uri === b.uri) {
    return true;
  }

  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.size !== null &&
    b.size !== null &&
    a.size === b.size
  );
}

/** Adds newly picked files without duplicating them or exceeding the cap. */
export function mergeAttachments(
  current: PickedAttachment[],
  incoming: PickedAttachment[]
): PickedAttachment[] {
  const merged = [...current];

  for (const item of incoming) {
    if (!merged.some((existing) => isSameAttachment(existing, item))) {
      merged.push(item);
    }

    if (merged.length >= MAX_ATTACHMENTS) {
      break;
    }
  }

  return limit(merged);
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
