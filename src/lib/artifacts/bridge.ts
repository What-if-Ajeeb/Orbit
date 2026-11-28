import {
  ARTIFACT_KV_KEY_MAX_CHARS,
  ARTIFACT_KV_VALUE_MAX_CHARS,
} from './types';

const SOURCE = 'orbit-artifact';
const MAX_BRIDGE_MESSAGE_LENGTH = 500;
const ERROR_LABELS: Record<string, string> = {
  error: 'Error',
  console_error: 'Console error',
  console_warn: 'Console warning',
};

export type ArtifactBridgeMessage =
  | { kind: 'error'; message: string }
  | {
      kind: 'storage';
      id: string;
      op: 'get' | 'set' | 'delete' | 'list';
      key: string;
      value?: string;
    };

export type ArtifactStorageReply =
  | { ok: true; value?: string | null | string[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    return null;
  }

  return value === '__proto__' || value === 'constructor' || value === 'prototype'
    ? null
    : value;
}

function validKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return null;
  }

  return value.length <= ARTIFACT_KV_KEY_MAX_CHARS ? value : null;
}

/**
 * Accepts only the two small message families the injected bridge can send:
 * error reports and scoped storage requests. Artifact content is never trusted
 * as a command; all storage access is re-scoped by the viewer's signed-in user
 * and artifact id before it reaches SQLite.
 */
export function parseArtifactBridgeMessage(data: string): ArtifactBridgeMessage | null {
  try {
    const parsed: unknown = JSON.parse(data);

    if (!isRecord(parsed) || parsed.source !== SOURCE) {
      return null;
    }

    const type = parsed.type;

    if (typeof type === 'string' && ERROR_LABELS[type]) {
      if (typeof parsed.message !== 'string' || parsed.message.length === 0) {
        return null;
      }

      return {
        kind: 'error',
        message: `${ERROR_LABELS[type]}: ${parsed.message.slice(0, MAX_BRIDGE_MESSAGE_LENGTH)}`,
      };
    }

    if (parsed.kind !== 'storage') {
      return null;
    }

    const id = validId(parsed.id);

    if (!id) {
      return null;
    }

    const op = parsed.op;

    if (op === 'list') {
      return { kind: 'storage', id, op, key: '' };
    }

    const key = validKey(parsed.key);

    if (!key || (op !== 'get' && op !== 'set' && op !== 'delete')) {
      return null;
    }

    if (op === 'set') {
      if (
        typeof parsed.value !== 'string' ||
        parsed.value.length > ARTIFACT_KV_VALUE_MAX_CHARS
      ) {
        return null;
      }

      return { kind: 'storage', id, op, key, value: parsed.value };
    }

    return { kind: 'storage', id, op, key };
  } catch {
    return null;
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Resolves one pending promise inside the WebView without evaluating artifact text. */
export function buildStorageReplyScript(
  id: string,
  reply: ArtifactStorageReply
): string {
  const callbackId = safeJson(id);
  const payload = safeJson(reply);

  return (
    `(function () {` +
    `var replies = window.__orbitStorageReplies;` +
    `if (!replies) return;` +
    `var callback = replies[${callbackId}];` +
    `if (typeof callback !== 'function') return;` +
    `delete replies[${callbackId}];` +
    `callback(${payload});` +
    `})()`
  );
}

/**
 * Installed with `injectedJavaScriptBeforeContentLoaded` for HTML artifacts.
 * It exposes a promise-based, localStorage-free API backed by the native
 * postMessage bridge. Requests and replies carry ids and values only; the
 * native side applies the user/artifact scope and all size limits again.
 */
export const ARTIFACT_STORAGE_BRIDGE_JS = [
  '(function () {',
  '  if (typeof window === "undefined") return;',
  '',
  '  var MAX_KEY_LENGTH = ' + ARTIFACT_KV_KEY_MAX_CHARS + ';',
  '  var MAX_VALUE_LENGTH = ' + ARTIFACT_KV_VALUE_MAX_CHARS + ';',
  '  var MAX_PENDING = 32;',
  '  var replies = Object.create(null);',
  '  var nextId = 1;',
  '  window.__orbitStorageReplies = replies;',
  '',
  '  function request(op, key, value) {',
  '    return new Promise(function (resolve, reject) {',
  "      if (op !== 'list') {",
  "        if (typeof key !== 'string' || key.length === 0 || key.trim().length === 0) {",
  "          reject(new Error('key must be a non-empty string.'));",
  '          return;',
  '        }',
  '        if (key.length > MAX_KEY_LENGTH) {',
  "          reject(new Error('key is too long.'));",
  '          return;',
  '        }',
  '      }',
  "      if (op === 'set' && typeof value !== 'string') {",
  "        reject(new Error('value must be a string.'));",
  '        return;',
  '      }',
  "      if (op === 'set' && value.length > MAX_VALUE_LENGTH) {",
  "        reject(new Error('value is too large.'));",
  '        return;',
  '      }',
  '      if (Object.keys(replies).length >= MAX_PENDING) {',
  "        reject(new Error('Too many storage requests are pending.'));",
  '        return;',
  '      }',
  '',
  "      var id = 's' + nextId + '_' + Math.random().toString(36).slice(2, 10);",
  '      nextId += 1;',
  '      replies[id] = function (reply) {',
  '        delete replies[id];',
  '        if (!reply || !reply.ok) {',
  '          var reason = reply && reply.error ? reply.error : "Storage request failed.";',
  '          reject(new Error(reason));',
  '          return;',
  '        }',
  '        resolve(reply.value);',
  '      };',
  '',
  '      try {',
  '        var bridge = window.ReactNativeWebView;',
  '        if (!bridge || typeof bridge.postMessage !== "function") {',
  '          throw new Error("Storage bridge is unavailable.");',
  '        }',
  '        bridge.postMessage(JSON.stringify({',
  "          source: 'orbit-artifact',",
  "          kind: 'storage',",
  '          id: id,',
  '          op: op,',
 "          key: op === 'list' ? '' : key,",
 "          value: op === 'set' ? value : undefined",
  '        }));',
  '      } catch (error) {',
  '        delete replies[id];',
  '        reject(error instanceof Error ? error : new Error(String(error)));',
  '      }',
  '    });',
  '  }',
  '',
  "  if (!window.orbit || typeof window.orbit !== 'object') {",
  '    window.orbit = {};',
  '  }',
  '  window.orbit.storage = {',
  "    get: function (key) { return request('get', key); },",
  "    set: function (key, value) { return request('set', key, value); },",
  "    delete: function (key) { return request('delete', key); },",
  "    list: function () { return request('list', ''); }",
  '  };',
  '})();',
].join('\n');
