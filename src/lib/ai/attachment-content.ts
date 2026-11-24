import type { LlmAttachment } from './types';

export const MAX_DOCUMENT_CHARS = 12_000;
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;

type ImageData = { mimeType: string; data: string };

function safeMimeType(value: string, kind: LlmAttachment['kind']): string {
  const allowed =
    kind === 'image'
      ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic']
      : [
          'text/plain',
          'text/markdown',
          'text/csv',
          'application/json',
          'application/pdf',
          'text/html',
        ];

  const clean = value.split(';')[0].trim().toLowerCase();
  return allowed.includes(clean) ? clean : kind === 'image' ? 'image/jpeg' : 'text/plain';
}

/** Human-readable context for documents; images are described by name only. */
export function buildAttachmentText(attachments: LlmAttachment[] = []): string {
  if (attachments.length === 0) {
    return '';
  }

  const lines = attachments.map((attachment) => {
    if (attachment.kind === 'image') {
      return `[Attached image: ${attachment.name}]`;
    }

    const text = attachment.data.slice(0, MAX_DOCUMENT_CHARS).trim();
    const suffix = attachment.data.length > MAX_DOCUMENT_CHARS ? '\n[document truncated]' : '';

    return `[Attached document: ${attachment.name}]\n${text}${suffix}`.trim();
  });

  return lines.join('\n\n');
}

export function safeImageAttachments(attachments: LlmAttachment[] = []): ImageData[] {
  return attachments
    .filter((attachment) => attachment.kind === 'image' && Boolean(attachment.data))
    .slice(0, 4)
    .map((attachment) => ({
      mimeType: safeMimeType(attachment.mimeType, 'image'),
      data: attachment.data.slice(0, MAX_IMAGE_BASE64_CHARS),
    }))
    .filter((image) => image.data.length > 0);
}

export function combineUserContent(message: string, attachments: LlmAttachment[] = []): string {
  const extra = buildAttachmentText(attachments);

  if (!extra) {
    return message;
  }

  return message.trim() ? `${message.trim()}\n\n${extra}` : extra;
}
