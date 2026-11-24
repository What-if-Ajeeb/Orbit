import { describe, expect, it } from 'vitest';

import {
  compareSemver,
  formatSemver,
  isVersionGreater,
  isValidRange,
  isValidSemver,
  parseSemver,
  satisfiesRange,
} from '../semver';

describe('plugin semantic versions', () => {
  it('parses strict versions with prerelease and build metadata', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
    expect(parseSemver(' 2.0.0-rc.1+build.7 ')).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: ['rc', '1'],
    });
    expect(formatSemver(parseSemver('2.0.0-rc.1+build.7')!)).toBe('2.0.0-rc.1');
  });

  it('rejects loose or malformed versions', () => {
    for (const value of ['1.2', 'v1.2.3', '01.2.3', '1.2.3.4', '1.2.x', '']) {
      expect(isValidSemver(value)).toBe(false);
    }
    expect(isValidSemver('0.0.0')).toBe(true);
    expect(isValidSemver('1.0.0-alpha+001')).toBe(true);
  });

  it('orders versions with prerelease rules', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1);
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(isVersionGreater('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.2', '1.0.0-alpha.10')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(() => compareSemver('1.2', '1.2.3')).toThrow(/invalid versions/);
  });

  it('supports exact, caret, tilde and explicit comparators', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.3', '=1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '=1.2.3')).toBe(false);
    expect(satisfiesRange('1.9.9', '^1.2.3')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesRange('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfiesRange('1.4.0', '>1.3.0 <=1.4.0')).toBe(true);
  });

  it('supports wildcards, alternatives and invalid versions', () => {
    expect(satisfiesRange('1.2.9', '1.2.x')).toBe(true);
    expect(satisfiesRange('1.3.0', '1.2.x')).toBe(false);
    expect(satisfiesRange('1.99.0', '1.x')).toBe(true);
    expect(satisfiesRange('9.9.9', '*')).toBe(true);
    expect(satisfiesRange('2.4.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
    expect(satisfiesRange('garbage', '*')).toBe(false);
  });

  it('recognizes valid range syntax without requiring a 0.0.0 match', () => {
    expect(isValidRange('^1.2.3')).toBe(true);
    expect(isValidRange('>=2.0.0 <3.0.0')).toBe(true);
    expect(isValidRange('1.2.x || 2.x')).toBe(true);
    expect(isValidRange('not-a-range')).toBe(false);
    expect(isValidRange('^1.2.3 || nonsense')).toBe(false);
  });
});
