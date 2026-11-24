import { ConnectionError } from './types';
import { googleApiFetch, googleApiJson, redactConnectionText } from './google';
import type { GoogleConnectionId } from './types';

const MAX_TEXT_CHARS = 20_000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Map<string, number>(
  Array.from(BASE64_ALPHABET).map((character, index) => [character, index])
);

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function requireString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConnectionError('api', `${field} is required.`);
  }

  const clean = value.trim();

  if (clean.length > max) {
    throw new ConnectionError('api', `${field} is too long.`);
  }

  if (/[\r\n]/.test(clean)) {
    throw new ConnectionError('api', `${field} cannot contain line breaks.`);
  }

  return clean;
}

function optionalString(value: unknown, max = 2_000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function stringArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .slice(0, max)
    .map((item) => requireString(item, 'recipient', 320));
}

function query(params: Record<string, string | number | undefined>): string {
  const pairs = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

function clampText(value: string): string {
  const clean = redactConnectionText(value);
  return clean.length > MAX_TEXT_CHARS ? `${clean.slice(0, MAX_TEXT_CHARS)}\n[truncated]` : clean;
}

export function utf8ToBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  let output = '';

  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    const second = index + 1 < binary.length ? binary.charCodeAt(index + 1) : -1;
    const third = index + 2 < binary.length ? binary.charCodeAt(index + 2) : -1;
    const triplet = (first << 16) | ((second < 0 ? 0 : second) << 8) | (third < 0 ? 0 : third);

    output += BASE64_ALPHABET[(triplet >> 18) & 63];
    output += BASE64_ALPHABET[(triplet >> 12) & 63];
    output += second < 0 ? '=' : BASE64_ALPHABET[(triplet >> 6) & 63];
    output += third < 0 ? '=' : BASE64_ALPHABET[triplet & 63];
  }

  return output.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToUtf8(input: string): string {
  const clean = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bytes: number[] = [];

  for (let index = 0; index < padded.length; index += 4) {
    const first = BASE64_LOOKUP.get(padded[index]) ?? 0;
    const second = BASE64_LOOKUP.get(padded[index + 1]) ?? 0;
    const third = padded[index + 2] === '=' ? -1 : (BASE64_LOOKUP.get(padded[index + 2]) ?? 0);
    const fourth = padded[index + 3] === '=' ? -1 : (BASE64_LOOKUP.get(padded[index + 3]) ?? 0);
    const triplet = (first << 18) | (second << 12) | ((third < 0 ? 0 : third) << 6) | (fourth < 0 ? 0 : fourth);

    bytes.push((triplet >> 16) & 255);

    if (third >= 0) {
      bytes.push((triplet >> 8) & 255);
    }

    if (fourth >= 0) {
      bytes.push(triplet & 255);
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function encodeMimeMessage(to: string, subject: string, body: string): string {
  return utf8ToBase64Url(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`
  );
}

function headerValue(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) {
    return '';
  }

  const found = headers.find((item) => {
    const record = asRecord(item);
    return record?.name?.toString().toLowerCase() === name.toLowerCase();
  });
  const record = asRecord(found);
  return typeof record?.value === 'string' ? record.value : '';
}

function findPlainBody(payload: unknown): string {
  const record = asRecord(payload);

  if (!record) {
    return '';
  }

  const body = asRecord(record.body);
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : '';

  if (typeof body?.data === 'string' && (mimeType === 'text/plain' || mimeType === '')) {
    try {
      return base64UrlToUtf8(body.data);
    } catch {
      return '';
    }
  }

  if (Array.isArray(record.parts)) {
    for (const part of record.parts) {
      const text = findPlainBody(part);

      if (text) {
        return text;
      }
    }
  }

  return '';
}

export async function gmailSearch(
  userId: number,
  args: Record<string, unknown>
): Promise<JsonRecord> {
  const queryText = optionalString(args.query, 300) ?? 'in:anywhere';
  const maxResults = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const data = await googleApiJson<JsonRecord>(
    userId,
    'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages${query({
      q: queryText,
      maxResults,
    })}`
  );
  const messages = Array.isArray(data.messages) ? data.messages : [];

  return {
    ok: true,
    count: messages.length,
    messages: messages.slice(0, maxResults).map((item) => {
      const record = asRecord(item);
      return { id: typeof record?.id === 'string' ? record.id : '' };
    }),
    resultSizeEstimate: data.resultSizeEstimate ?? 0,
  };
}

export async function gmailRead(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const messageId = requireString(args.messageId, 'messageId', 200).replace(/[^\w-]/g, '');
  const data = await googleApiJson<JsonRecord>(
    userId,
    'gmail',
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
  );
  const payload = asRecord(data.payload);
  const headers = payload?.headers;
  const body = clampText(findPlainBody(payload) || (typeof data.snippet === 'string' ? data.snippet : ''));

  return {
    ok: true,
    id: data.id,
    threadId: data.threadId,
    subject: headerValue(headers, 'subject'),
    from: headerValue(headers, 'from'),
    to: headerValue(headers, 'to'),
    date: headerValue(headers, 'date'),
    body,
  };
}

export async function gmailDraft(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const to = requireString(args.to, 'to', 320);
  const subject = requireString(args.subject, 'subject', 200);
  const body = requireString(args.body, 'body', 10_000);
  const data = await googleApiJson<JsonRecord>(
    userId,
    'gmail',
    'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
    {
      method: 'POST',
      body: JSON.stringify({
        message: { raw: encodeMimeMessage(to, subject, body) },
      }),
    }
  );

  return { ok: true, id: data.id, messageId: asRecord(data.message)?.id ?? null };
}

export async function gmailSend(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const to = requireString(args.to, 'to', 320);
  const subject = requireString(args.subject, 'subject', 200);
  const body = requireString(args.body, 'body', 10_000);
  const data = await googleApiJson<JsonRecord>(
    userId,
    'gmail',
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw: encodeMimeMessage(to, subject, body) }),
    }
  );

  return { ok: true, id: data.id, threadId: data.threadId };
}

function calendarTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ConnectionError('api', 'Calendar time must be a valid ISO date.');
  }

  return parsed.toISOString();
}

export async function calendarSearch(
  userId: number,
  args: Record<string, unknown>
): Promise<JsonRecord> {
  const now = new Date();
  const timeMin = calendarTime(args.timeMin, now.toISOString());
  const timeMax = calendarTime(
    args.timeMax,
    new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
  );
  const data = await googleApiJson<JsonRecord>(
    userId,
    'google_calendar',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events${query({
      timeMin,
      timeMax,
      q: optionalString(args.query, 300),
      maxResults: Math.min(Math.max(Number(args.limit) || 10, 1), 25),
      singleEvents: 'true',
      orderBy: 'startTime',
    })}`
  );
  const items = Array.isArray(data.items) ? data.items : [];

  return {
    ok: true,
    count: items.length,
    events: items.slice(0, 25).map((item) => {
      const record = asRecord(item);
      const start = asRecord(record?.start);
      return {
        id: record?.id,
        summary: record?.summary,
        start: start?.dateTime ?? start?.date,
        location: record?.location,
      };
    }),
  };
}

export async function calendarCreate(
  userId: number,
  args: Record<string, unknown>
): Promise<JsonRecord> {
  const summary = requireString(args.summary, 'summary', 200);
  const start = calendarTime(args.start, '');
  const end = calendarTime(args.end, '');
  const attendees = stringArray(args.attendees).map((email) => ({ email }));

  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new ConnectionError('api', 'The event end must be after its start.');
  }

  const data = await googleApiJson<JsonRecord>(
    userId,
    'google_calendar',
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      body: JSON.stringify({
        summary,
        description: optionalString(args.description, 4_000),
        location: optionalString(args.location, 300),
        start: { dateTime: start },
        end: { dateTime: end },
        ...(attendees.length > 0 ? { attendees } : {}),
      }),
    }
  );

  return { ok: true, id: data.id, htmlLink: data.htmlLink, status: data.status };
}

export async function calendarUpdate(
  userId: number,
  args: Record<string, unknown>
): Promise<JsonRecord> {
  const eventId = requireString(args.eventId, 'eventId', 200).replace(/[^\w-]/g, '');
  const patch: JsonRecord = {};

  if (args.summary !== undefined) {
    patch.summary = requireString(args.summary, 'summary', 200);
  }

  if (args.description !== undefined) {
    patch.description = optionalString(args.description, 4_000) ?? '';
  }

  if (args.start !== undefined) {
    patch.start = { dateTime: calendarTime(args.start, '') };
  }

  if (args.end !== undefined) {
    patch.end = { dateTime: calendarTime(args.end, '') };
  }

  if (Object.keys(patch).length === 0) {
    throw new ConnectionError('api', 'Provide at least one field to change.');
  }

  const data = await googleApiJson<JsonRecord>(
    userId,
    'google_calendar',
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) }
  );

  return { ok: true, id: data.id, htmlLink: data.htmlLink, status: data.status };
}

export async function driveSearch(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const pageSize = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
  const q = optionalString(args.query, 300) ?? 'trashed = false';
  const data = await googleApiJson<JsonRecord>(
    userId,
    'google_drive',
    `https://www.googleapis.com/drive/v3/files${query({
      q,
      pageSize,
      fields: 'files(id,name,mimeType,modifiedTime,size),nextPageToken',
    })}`
  );
  const files = Array.isArray(data.files) ? data.files : [];

  return {
    ok: true,
    count: files.length,
    files,
    nextPageToken: data.nextPageToken ?? null,
  };
}

export async function driveRead(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const fileId = requireString(args.fileId, 'fileId', 200).replace(/[^\w-]/g, '');
  const meta = await googleApiJson<JsonRecord>(
    userId,
    'google_drive',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`
  );
  const mimeType = typeof meta.mimeType === 'string' ? meta.mimeType : '';
  const isText = mimeType.startsWith('text/') || mimeType === 'application/json';

  if (!isText) {
    return {
      ok: true,
      file: meta,
      text: null,
      note: 'This file is not plain text; only its metadata is shown.',
    };
  }

  const response = await googleApiFetch(
    userId,
    'google_drive',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
  );
  const raw = await response.text();

  return { ok: true, file: meta, text: clampText(raw) };
}

export async function driveTrash(userId: number, args: Record<string, unknown>): Promise<JsonRecord> {
  const fileId = requireString(args.fileId, 'fileId', 200).replace(/[^\w-]/g, '');
  const data = await googleApiJson<JsonRecord>(
    userId,
    'google_drive',
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/trash`,
    { method: 'POST', body: JSON.stringify({}) }
  );

  return { ok: true, id: data.id, name: data.name, trashed: data.trashed };
}

export function listConnectionActions(id: GoogleConnectionId): string[] {
  switch (id) {
    case 'gmail':
      return ['Search mail', 'Read a message', 'Create a draft', 'Send mail'];
    case 'google_calendar':
      return ['Find events', 'Create an event', 'Change an event'];
    case 'google_drive':
      return ['Search files', 'Read text files', 'Move a file to trash'];
  }
}
