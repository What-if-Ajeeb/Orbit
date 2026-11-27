import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value ?? null);
}

export function hashChain(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(stableJson(value))));
}
