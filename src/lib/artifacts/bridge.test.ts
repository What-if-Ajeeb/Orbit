import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_STORAGE_BRIDGE_JS,
  buildStorageReplyScript,
  parseArtifactBridgeMessage,
} from './bridge';
import { ARTIFACT_KV_KEY_MAX_CHARS, ARTIFACT_KV_VALUE_MAX_CHARS } from './types';

describe('artifact bridge messages', () => {
  it('keeps the existing error message shape', () => {
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({ source: 'orbit-artifact', type: 'error', message: 'boom' })
      )
    ).toEqual({ kind: 'error', message: 'Error: boom' });
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({
          source: 'orbit-artifact',
          type: 'console_warn',
          message: 'watch out',
        })
      )
    ).toEqual({ kind: 'error', message: 'Console warning: watch out' });
  });

  it('parses only validated storage requests', () => {
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({
          source: 'orbit-artifact',
          kind: 'storage',
          id: 's1_abc',
          op: 'get',
          key: 'tasks',
        })
      )
    ).toEqual({ kind: 'storage', id: 's1_abc', op: 'get', key: 'tasks' });
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({
          source: 'orbit-artifact',
          kind: 'storage',
          id: 's2_abc',
          op: 'set',
          key: 'tasks',
          value: '[]',
        })
      )
    ).toEqual({ kind: 'storage', id: 's2_abc', op: 'set', key: 'tasks', value: '[]' });
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({
          source: 'orbit-artifact',
          kind: 'storage',
          id: 's3_abc',
          op: 'list',
        })
      )
    ).toEqual({ kind: 'storage', id: 's3_abc', op: 'list', key: '' });
  });

  it('rejects foreign, malformed and oversized messages', () => {
    const base = { source: 'orbit-artifact', kind: 'storage', id: 's1_abc', op: 'get', key: 'k' };

    expect(parseArtifactBridgeMessage('not json')).toBeNull();
    expect(parseArtifactBridgeMessage(JSON.stringify({ ...base, source: 'evil' }))).toBeNull();
    expect(parseArtifactBridgeMessage(JSON.stringify({ ...base, id: '__proto__' }))).toBeNull();
    expect(parseArtifactBridgeMessage(JSON.stringify({ ...base, op: 'drop' }))).toBeNull();
    expect(parseArtifactBridgeMessage(JSON.stringify({ ...base, key: '' }))).toBeNull();
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({ ...base, key: 'k'.repeat(ARTIFACT_KV_KEY_MAX_CHARS + 1) })
      )
    ).toBeNull();
    expect(
      parseArtifactBridgeMessage(
        JSON.stringify({
          ...base,
          op: 'set',
          value: 'x'.repeat(ARTIFACT_KV_VALUE_MAX_CHARS + 1),
        })
      )
    ).toBeNull();
  });

  it('builds escaped replies that resolve one pending callback', () => {
    const script = buildStorageReplyScript('s1_abc', {
      ok: true,
      value: '</script><script>alert(1)</script>',
    });

    expect(script).toContain('window.__orbitStorageReplies');
    expect(script).toContain('delete replies["s1_abc"]');
    expect(script).not.toContain('</script>');
    expect(script).toContain('\\u003c/script\\u003e');
  });
});

describe('ARTIFACT_STORAGE_BRIDGE_JS', () => {
  it('exposes the four storage methods without localStorage', () => {
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain('window.orbit.storage');
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain("get: function (key)");
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain("set: function (key, value)");
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain("delete: function (key)");
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain("list: function ()");
    expect(ARTIFACT_STORAGE_BRIDGE_JS).toContain('ReactNativeWebView');
    expect(ARTIFACT_STORAGE_BRIDGE_JS.toLowerCase()).not.toContain('localstorage');
    expect(ARTIFACT_STORAGE_BRIDGE_JS).not.toContain('fetch(');
  });
});
