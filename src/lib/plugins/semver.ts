/**
 * Small, dependency-free semantic-version implementation used for plugin
 * versions, minimum Orbit versions and dependency ranges.
 *
 * Supported range syntax:
 *   `1.2.3`, `=1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.0.0`, `>1.0.0`,
 *   `<=2.0.0`, `<2.0.0`, `1.2.x`, `1.x`, `*`, and space-separated
 *   conjunctions such as `>=1.0.0 <2.0.0`.
 */

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

export function isValidSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 0;
  }

  if (a.length === 0) {
    return 1;
  }

  if (b.length === 0) {
    return -1;
  }

  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const left = a[index];
    const right = b[index];

    if (left === undefined) {
      return -1;
    }

    if (right === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);

      if (diff !== 0) {
        return diff < 0 ? -1 : 1;
      }
      continue;
    }

    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }

  return 0;
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);

  if (!left || !right) {
    throw new Error(`Cannot compare invalid versions "${a}" and "${b}".`);
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

export function isVersionGreater(a: string, b: string): boolean {
  return compareSemver(a, b) > 0;
}

type Comparator = {
  operator: '=' | '>' | '>=' | '<' | '<=';
  version: Semver;
};

function nextMajor(version: Semver): Semver {
  return { major: version.major + 1, minor: 0, patch: 0, prerelease: [] };
}

function nextMinor(version: Semver): Semver {
  return {
    major: version.major,
    minor: version.minor + 1,
    patch: 0,
    prerelease: [],
  };
}

function compareParsed(a: Semver, b: Semver): number {
  return compareSemver(formatSemver(a), formatSemver(b));
}

function parseComparator(token: string): Comparator[] | null {
  const trimmed = token.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed === '*' || trimmed === 'x' || trimmed === 'X') {
    return [];
  }

  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(trimmed);

  if (!match) {
    return null;
  }

  const operator = match[1] ?? '=';
  const rawVersion = match[2];

  // Wildcards such as 1.x / 1.2.x.
  if (/(^|\.)(x|X|\*)$/.test(rawVersion)) {
    const numeric = rawVersion.split('.').filter((part) => /^\d+$/.test(part));

    if (numeric.length === 0) {
      return [];
    }

    if (numeric.length === 1) {
      const major = Number(numeric[0]);
      return [
        { operator: '>=', version: { major, minor: 0, patch: 0, prerelease: [] } },
        { operator: '<', version: nextMajor({ major, minor: 0, patch: 0, prerelease: [] }) },
      ];
    }

    const major = Number(numeric[0]);
    const minor = Number(numeric[1]);
    return [
      { operator: '>=', version: { major, minor, patch: 0, prerelease: [] } },
      {
        operator: '<',
        version: nextMinor({ major, minor, patch: 0, prerelease: [] }),
      },
    ];
  }

  const version = parseSemver(rawVersion);

  if (!version) {
    return null;
  }

  switch (operator) {
    case '^':
      return [
        { operator: '>=', version },
        {
          operator: '<',
          version:
            version.major > 0
              ? nextMajor(version)
              : nextMinor({ major: 0, minor: version.minor, patch: 0, prerelease: [] }),
        },
      ];
    case '~':
      return [
        { operator: '>=', version },
        { operator: '<', version: nextMinor(version) },
      ];
    default:
      return [{ operator: operator as Comparator['operator'], version }];
  }
}

export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseSemver(version);

  if (!parsed) {
    return false;
  }

  const alternatives = range.split('||');

  return alternatives.some((alternative) => {
    const tokens = alternative.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
      return false;
    }

    const comparators: Comparator[] = [];

    for (const token of tokens) {
      const parsedToken = parseComparator(token);

      if (parsedToken === null) {
        return false;
      }

      comparators.push(...parsedToken);
    }

    return comparators.every((comparator) => {
      const diff = compareParsed(parsed, comparator.version);

      switch (comparator.operator) {
        case '=':
          return diff === 0;
        case '>':
          return diff > 0;
        case '>=':
          return diff >= 0;
        case '<':
          return diff < 0;
        case '<=':
          return diff <= 0;
        default:
          return false;
      }
    });
  });
}

export function isValidRange(range: string): boolean {
  return satisfiesRange('0.0.0', range) || parseRange(range);
}

function parseRange(range: string): boolean {
  return range
    .split('||')
    .every((alternative) => {
      const tokens = alternative.trim().split(/\s+/).filter(Boolean);

      if (tokens.length === 0) {
        return true;
      }

      return tokens.every((token) => {
        const trimmed = token.trim();

        if (trimmed === '*' || trimmed === 'x' || trimmed === 'X') {
          return true;
        }

        const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(trimmed);

        if (!match) {
          return false;
        }

        const rawVersion = match[2];

        if (/(^|\.)(x|X|\*)$/.test(rawVersion)) {
          return /^[0-9xX*]+(\.[0-9xX*]+)*$/.test(rawVersion);
        }

        return parseSemver(rawVersion) !== null;
      });
    });
}

export function formatSemver(version: Semver): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease.length > 0
    ? `${base}-${version.prerelease.join('.')}`
    : base;
}
