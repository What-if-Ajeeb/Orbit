import type { RiskLevel } from './types';

export type CommandAssessment = {
  risk: RiskLevel;
  blocked: boolean;
  safe: boolean;
  reason: string;
};

/**
 * Commands that stay blocked even if the user approves a high-risk request.
 * These can cause unrecoverable damage or bypass the permission boundary.
 */
const HARD_BLOCKED: [RegExp, string][] = [
  [/\b(?:sudo|su|doas)\b/i, 'Privilege escalation is not allowed.'],
  [/\bmkfs(?:\.[a-z0-9]+)?\b/i, 'Formatting filesystems is not allowed.'],
  [/\bdd\s+if=.*\bof=/i, 'Raw disk writes are not allowed.'],
  [/\b(?:shutdown|poweroff|halt)\b/i, 'Shutting down the computer is not allowed.'],
  [/\breboot\b/i, 'Rebooting the computer is not allowed.'],
  [/\binit\s+[06]\b/i, 'Changing the system runlevel is not allowed.'],
  [/\bformat\s+[a-z]:/i, 'Formatting a drive is not allowed.'],
  [/\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(?:\s|$)/i, 'Recursive deletion of the filesystem root is not allowed.'],
  [/\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+\/(?:\s|$)/i, 'Recursive deletion of the filesystem root is not allowed.'],
  [/\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+~(?:\s|$)/i, 'Recursive deletion of your home directory is not allowed.'],
  [/\brm\s+-[a-z]*f[a-z]*r[a-z]*\s+~(?:\s|$)/i, 'Recursive deletion of your home directory is not allowed.'],
  [/\bchmod\s+(?:-R\s+)?777\s+\/(?:\s|$)/i, 'World-writable permissions on the filesystem root are not allowed.'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'Fork bombs are not allowed.'],
  [/\b(?:curl|wget)\b[^|]*\|\s*(?:ba|z|k|d)?sh\b/i, 'Piping downloads into a shell is not allowed.'],
  [/\bgit\s+push\s+(?:--force|-f)\b/i, 'Force-pushing is not allowed from an agent session.'],
  [/\bnpm\s+publish\b/i, 'Publishing packages is not allowed from an agent session.'],
];

/**
 * Known build/test/read commands can be approved as medium risk. Everything
 * else is high risk and must be approved for every single invocation.
 */
const MEDIUM_RISK_PREFIXES: RegExp[] = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:test|run|ci|exec|ls|outdated|audit)\b/i,
  /^(?:npm|pnpm|yarn|bun)\s+install\b/i,
  /^(?:npx|bunx)\s+(?:tsc|expo|jest|vitest|eslint|prettier|next)\b/i,
  /^(?:git)\s+(?:status|diff|log|branch|show|rev-parse|fetch)\b/i,
  /^(?:ls|pwd|cat|head|tail|grep|rg|find|wc|stat|du|df|which|whoami|echo)\b/i,
  /^(?:node|python3?|ruby|php)\s+(?:-v|--version)\b/i,
  /^(?:node|python3?|ruby|php)\s+.+(?:test|spec|script)\b/i,
  /^(?:cargo|go|dotnet|swift|gradle|mvn)\s+(?:build|test|check|run|assemble)\b/i,
  /^(?:make|cmake)\b/i,
  /^(?:tsc|eslint|prettier|jest|vitest)\b/i,
];

/** Commands with names that inherently delete, install, or publish. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\bunlink\b/i,
  /\bmv\b/i,
  /\binstall\b/i,
  /\b(?:apt|apt-get|brew|choco|winget|scoop)\b/i,
  /\bpip\s+install\b/i,
  /\bgit\s+(?:push|reset\s+--hard|clean\s+-[a-z]*f)\b/i,
  /\b(?:docker|kubectl|terraform)\b/i,
  /\b(?:curl|wget)\b/i,
  /\b(?:ssh|scp|rsync)\b/i,
  /(?:^|\s)(?:>|>>)\s*[^&]/i,
  /\$\(/,
  /`/,
];

export function assessCommand(command: string): CommandAssessment {
  const text = command.trim();

  if (!text) {
    return {
      risk: 'high',
      blocked: true,
      safe: false,
      reason: 'The command is empty.',
    };
  }

  for (const [pattern, reason] of HARD_BLOCKED) {
    if (pattern.test(text)) {
      return { risk: 'high', blocked: true, safe: false, reason };
    }
  }

  const segments = text
    .split(/\s*(?:&&|\|\||;|\n)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const allSegmentsSafe =
    segments.length > 0 &&
    segments.every((segment) => MEDIUM_RISK_PREFIXES.some((prefix) => prefix.test(segment)));

  const hasHighRiskPattern = HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text));

  if (allSegmentsSafe && !hasHighRiskPattern) {
    return {
      risk: 'medium',
      blocked: false,
      safe: true,
      reason: 'This is a sandbox-friendly build, test, or read command.',
    };
  }

  return {
    risk: 'high',
    blocked: false,
    safe: false,
    reason:
      'This command is not in the sandbox allowlist. It can change the computer and needs approval for every run.',
  };
}

export function blockedCommandReason(command: string): string | null {
  const assessment = assessCommand(command);
  return assessment.blocked ? assessment.reason : null;
}

const DENIED_PATH_PREFIXES = [
  '/etc',
  '/system',
  '/proc',
  '/sys',
  '/boot',
  '/dev',
  '/var/lib',
  '/private/etc',
  'c:\\windows',
  'c:\\program files',
];

/**
 * Lightweight client-side path guard. The Desktop Companion repeats the check
 * against its configured workspace roots before it executes anything.
 */
export function validatePath(path: string | null): string | null {
  if (!path) {
    return null;
  }

  const normalized = path.trim().replace(/\\/g, '/').toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes('../') || normalized.endsWith('/..') || normalized === '..') {
    return 'Path traversal is not allowed.';
  }

  for (const denied of DENIED_PATH_PREFIXES) {
    const prefix = denied.replace(/\\/g, '/');

    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return 'That system path is protected.';
    }
  }

  return null;
}
