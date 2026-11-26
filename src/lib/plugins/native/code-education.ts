import type { LlmAttachment, LlmMessage } from '@/lib/ai/types';

export const EDUCATION_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export type EducationImage = LlmAttachment & { kind: 'image' };

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
]);
export const MAX_IMAGE_BASE64_CHARS = 4_000_000;

const RESPONSE_RULES = [
  'Return only one valid JSON object.',
  'Do not use markdown fences or commentary outside the JSON.',
  'Teach and explain only; never claim to execute code, open files or edit files.',
  'Keep strings concise and readable on a phone screen.',
].join(' ');

export function normalizeLevel(value: unknown): EducationLevel {
  return EDUCATION_LEVELS.includes(value as EducationLevel)
    ? (value as EducationLevel)
    : 'intermediate';
}

export function readImageAttachment(value: unknown): EducationImage | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('image must be an object.');
  }

  const record = value as Record<string, unknown>;
  const data = record.data;

  if (typeof data !== 'string' || data.trim().length === 0) {
    throw new Error('image.data must be a non-empty base64 string.');
  }

  if (data.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error(`image.data must be at most ${MAX_IMAGE_BASE64_CHARS} characters.`);
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) {
    throw new Error('image.data must be base64-encoded image data.');
  }

  const rawMimeType =
    typeof record.mimeType === 'string'
      ? record.mimeType.split(';')[0].trim().toLowerCase()
      : 'image/jpeg';

  if (!IMAGE_MIME_TYPES.has(rawMimeType)) {
    throw new Error(
      `image.mimeType must be one of: ${Array.from(IMAGE_MIME_TYPES).join(', ')}.`
    );
  }

  const name =
    typeof record.name === 'string' && record.name.trim()
      ? record.name.trim().slice(0, 120)
      : 'problem-image';

  return { name, kind: 'image', mimeType: rawMimeType, data };
}

function extractJsonObject(text: string): Record<string, unknown> {
  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start === -1 || end <= start) {
    throw new Error('The AI education response did not contain a JSON object.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new Error('The AI education response was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The AI education response must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

/**
 * Uses the app's configured AI provider through the existing adapter registry.
 * No model client, prompt loop or plugin runtime is created here.
 */
export async function requestEducationJson(
  systemPrompt: string,
  userPrompt: string,
  options: { image?: EducationImage; signal?: AbortSignal } = {}
): Promise<Record<string, unknown>> {
  const messages: LlmMessage[] = [
    { role: 'system', content: `${systemPrompt}\n\n${RESPONSE_RULES}` },
    {
      role: 'user',
      content: userPrompt,
      ...(options.image ? { attachments: [options.image] } : {}),
    },
  ];

  const [{ requestCompletion }, { loadAiSettings }] = await Promise.all([
    import('@/lib/ai/providers'),
    import('@/lib/ai/settings'),
  ]);
  const settings = await loadAiSettings();
  const turn = await requestCompletion(settings, messages, [], {
    signal: options.signal,
  });

  return extractJsonObject(turn.text);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asText(value: unknown, maxLength = 4_000, trim = true): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = trim ? value.trim() : value;

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}\n[truncated]`
    : normalized;
}

export function asTextList(
  value: unknown,
  maxItems = 12,
  itemMaxLength = 600
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];

  for (const entry of value) {
    const text = asText(entry, itemMaxLength);

    if (text && !result.includes(text)) {
      result.push(text);
    }

    if (result.length >= maxItems) {
      break;
    }
  }

  return result;
}

export function asLineNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.min(Math.trunc(value), 999)
    : fallback;
}
