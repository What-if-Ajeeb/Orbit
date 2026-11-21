const SECRET_KEY =
  /(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|cookie|session|otp|pin)/i;

const COMMAND_SECRET_PATTERNS: [RegExp, string][] = [
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  [
    /("(?:[^"]*?)(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|cookie|session|otp|pin)(?:[^"]*?)"\s*:\s*)("[^"]*"|[^,}\s]+)/gi,
    '$1"[redacted]"',
  ],
  [
    /(\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*=\s*)(["']?)([^\s"']+)/gi,
    '$1$2[redacted]',
  ],
  [
    /(\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|authorization)\b["']?\s*[=:]\s*)(["']?)([^\s"',;]+)/gi,
    '$1$2[redacted]',
  ],
  [/(--(?:password|token|secret|api-key)(?:=|\s+))[^\s]+/gi, '$1[redacted]'],
  [/\/\/([^/@:\s]+):([^/@\s]+)@/g, '//[redacted]:[redacted]@'],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '[private key redacted]',
  ],
  [/\b(?:sk|pk|rk)[-_][A-Za-z0-9]{12,}\b/g, '[key redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[token redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[access key redacted]'],
  [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[api key redacted]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[token redacted]'],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '[jwt redacted]',
  ],
];

export function redactSecrets(value: string): string {
  let output = value;

  for (const [pattern, replacement] of COMMAND_SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

function stringifyPreview(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return truncate(redactSecrets(value), 160);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return truncate(
      value
        .slice(0, 4)
        .map((entry) => stringifyPreview(entry, depth + 1))
        .join(', '),
      160
    );
  }

  if (typeof value === 'object') {
    if (depth > 2) {
      return '[object]';
    }

    try {
      const json = JSON.stringify(value, (key, nested) =>
        isSecretKey(key) ? '[redacted]' : nested
      );
      return truncate(redactSecrets(json), 160);
    } catch {
      return '[object]';
    }
  }

  return '';
}

/**
 * Formats a small, display-safe description of tool arguments. Secret-looking
 * keys are omitted and every value is redacted before it can reach the dialog.
 */
export function summarizeArguments(
  args: Record<string, unknown>,
  maxFields = 4
): string[] {
  const preferred = [
    'command',
    'cmd',
    'path',
    'file',
    'file_path',
    'cwd',
    'url',
    'query',
    'title',
    'name',
    'task_id',
    'id',
    'status',
    'server',
    'tool',
    'recipient',
    'amount',
  ];
  const keys = Object.keys(args);
  const ordered = [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key)),
  ];
  const result: string[] = [];

  for (const key of ordered) {
    if (result.length >= maxFields) {
      break;
    }

    if (isSecretKey(key)) {
      continue;
    }

    const preview = stringifyPreview(args[key]);

    if (!preview) {
      continue;
    }

    result.push(`${key.replace(/_/g, ' ')}: ${preview}`);
  }

  return result;
}

export function redactValue(value: unknown): string {
  return truncate(redactSecrets(stringifyPreview(value)), 500);
}
