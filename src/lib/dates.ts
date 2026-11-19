const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function dayDifference(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase();
}

export function formatDateShort(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateTime(timestamp: number): string {
  return `${formatDateShort(timestamp)} · ${formatTime(timestamp)}`;
}

/** "Today, 6:30 pm" / "Tomorrow, 9:00 am" / "20 Nov, 5:00 pm" */
export function formatDue(timestamp: number | null): string {
  if (!timestamp) {
    return 'No date';
  }

  const difference = dayDifference(timestamp, Date.now());

  if (difference === 0) {
    return `Today, ${formatTime(timestamp)}`;
  }

  if (difference === 1) {
    return `Tomorrow, ${formatTime(timestamp)}`;
  }

  if (difference === -1) {
    return `Yesterday, ${formatTime(timestamp)}`;
  }

  return `${formatDateShort(timestamp)}, ${formatTime(timestamp)}`;
}

export function formatRelative(timestamp: number): string {
  const difference = timestamp - Date.now();
  const absolute = Math.abs(difference);

  if (absolute < 60_000) {
    return difference >= 0 ? 'in a moment' : 'just now';
  }

  const minutes = Math.round(absolute / 60_000);

  if (minutes < 60) {
    return difference >= 0 ? `in ${minutes} min` : `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return difference >= 0 ? `in ${hours} h` : `${hours} h ago`;
  }

  const days = Math.round(hours / 24);
  return difference >= 0 ? `in ${days} d` : `${days} d ago`;
}

/** A verbose timestamp the model can reason about, e.g. "Thursday, 19 Nov 2026, 7:42 pm". */
export function formatForModel(timestamp: number = Date.now()): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

export type ParsedTaskText = {
  title: string;
  dueAt: number | null;
  /** True when a date or a time expression was found in the text. */
  hasTime: boolean;
};

function cleanTitle(value: string, fallback: string): string {
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/[\s,;:.\-–—]+$/, '')
    .replace(/\s+(?:ko|par|pe|at|on|by)$/i, '')
    .trim();

  return cleaned.length > 0 ? cleaned : fallback.trim();
}

function buildTimestamp(
  baseDay: number,
  hour: number,
  minute: number
): number {
  const date = new Date(baseDay);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/**
 * Lightweight local parser for quick-add and the offline agent fallback.
 * Understands English + common Hinglish time phrases such as
 * "pay bill tomorrow at 6pm", "kal 5 baje meeting", "in 30 minutes".
 */
export function parseTaskText(raw: string, now: number = Date.now()): ParsedTaskText {
  const fallback = raw.trim();
  let text = ` ${raw.trim()} `;
  let hasTime = false;
  let dueAt: number | null = null;

  // Relative phrases: "in 30 minutes", "after 2 hours", "3 din baad".
  const relative = text.match(
    /\b(?:in|after)\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|days?)\b/i
  );

  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = unit.startsWith('min')
      ? 60_000
      : unit.startsWith('h')
        ? 60 * 60_000
        : DAY_MS;

    dueAt = now + amount * multiplier;
    text = text.replace(relative[0], ' ');
    hasTime = true;

    return { title: cleanTitle(text, fallback), dueAt, hasTime };
  }

  // Day words.
  let dayOffset: number | null = null;
  const dayPatterns: { pattern: RegExp; offset: number }[] = [
    { pattern: /\b(?:day after tomorrow|parso)\b/i, offset: 2 },
    { pattern: /\b(?:tomorrow|kal)\b/i, offset: 1 },
    { pattern: /\b(?:today|aaj)\b/i, offset: 0 },
  ];

  for (const entry of dayPatterns) {
    if (entry.pattern.test(text)) {
      dayOffset = entry.offset;
      hasTime = true;
      text = text.replace(entry.pattern, ' ');
      break;
    }
  }

  // Period of day, used when no explicit clock time is given.
  const periodPatterns: { pattern: RegExp; hour: number; dayOffset?: number }[] = [
    { pattern: /\btonight\b/i, hour: 21, dayOffset: 0 },
    { pattern: /\b(?:morning|subah)\b/i, hour: 9 },
    { pattern: /\b(?:afternoon|dopahar)\b/i, hour: 14 },
    { pattern: /\b(?:evening|shaam)\b/i, hour: 18 },
    { pattern: /\b(?:night|raat)\b/i, hour: 21 },
  ];

  let periodHour: number | null = null;
  let periodIsMorning = false;

  for (const entry of periodPatterns) {
    if (entry.pattern.test(text)) {
      periodHour = entry.hour;
      periodIsMorning = entry.hour === 9;
      hasTime = true;

      if (entry.dayOffset !== undefined && dayOffset === null) {
        dayOffset = entry.dayOffset;
      }

      text = text.replace(entry.pattern, ' ');
      break;
    }
  }

  // Explicit clock times.
  let hour: number | null = null;
  let minute = 0;
  let period: 'am' | 'pm' | null = null;

  const amPmMatch = text.match(
    /\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );

  const colonMatch = text.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  const bajeMatch = text.match(/\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(?:baje|bje)\b/i);

  if (amPmMatch) {
    hour = Number(amPmMatch[1]);
    minute = amPmMatch[2] ? Number(amPmMatch[2]) : 0;
    period = amPmMatch[3].toLowerCase().startsWith('a') ? 'am' : 'pm';
    text = text.replace(amPmMatch[0], ' ');
    hasTime = true;
  } else if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
    text = text.replace(colonMatch[0], ' ');
    hasTime = true;
  } else if (bajeMatch) {
    hour = Number(bajeMatch[1]);
    minute = bajeMatch[2] ? Number(bajeMatch[2]) : 0;

    if (hour < 12 && !periodIsMorning) {
      hour += 12;
    }

    text = text.replace(bajeMatch[0], ' ');
    hasTime = true;
  }

  if (hour === null && periodHour !== null) {
    hour = periodHour;
  }

  if (hour !== null) {
    if (hour > 23) {
      hour = hour % 24;
    }

    if (period === 'pm' && hour < 12) {
      hour += 12;
    }

    if (period === 'am' && hour === 12) {
      hour = 0;
    }

    const base = dayOffset === null ? startOfDay(now) : addDays(startOfDay(now), dayOffset);
    dueAt = buildTimestamp(base, hour, minute);

    if (dayOffset === null && dueAt <= now + 60_000) {
      dueAt = buildTimestamp(addDays(startOfDay(now), 1), hour, minute);
    }
  } else if (dayOffset !== null) {
    dueAt = buildTimestamp(addDays(startOfDay(now), dayOffset), 9, 0);
  }

  return { title: cleanTitle(text, fallback), dueAt, hasTime };
}

export function isPast(timestamp: number | null): boolean {
  return timestamp !== null && timestamp < Date.now();
}
