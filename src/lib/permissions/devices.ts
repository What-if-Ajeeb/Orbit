import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { SQLiteDatabase } from 'expo-sqlite';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { blockedCommandReason, validatePath } from './command-policy';
import { permissionManager } from './manager';
import { redactSecrets, truncate } from './redact';
import { PermissionStore } from './store';
import type { PairedDeviceRecord } from './types';

const TOKEN_KEY_PREFIX = 'orbit.companion.session.';
const PAIR_TIMEOUT_MS = 20_000;
const EXECUTE_TIMEOUT_MS = 45_000;

export type CompanionExecutionResult = {
  deviceId: string;
  deviceName: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type PairCompanionInput = {
  db: SQLiteDatabase;
  userId: number;
  name: string;
  endpoint: string;
  code: string;
};

type PairResponse = {
  deviceId?: unknown;
  token?: unknown;
  fingerprint?: unknown;
  name?: unknown;
  platform?: unknown;
  capabilities?: unknown;
};

function tokenKey(deviceId: string): string {
  return `${TOKEN_KEY_PREFIX}${deviceId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function normalizeEndpoint(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid companion URL, for example https://studio.local:8787.');
  }

  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '10.0.2.2';

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('ORBIT Desktop Companion must use HTTPS (or a loopback address for local development).');
  }

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function pairCompanion(input: PairCompanionInput): Promise<PairedDeviceRecord> {
  if (Platform.OS === 'web') {
    throw new Error('Desktop Companion pairing is available in the Android and iOS app.');
  }

  const name = input.name.trim();
  const code = input.code.trim();
  const endpoint = normalizeEndpoint(input.endpoint);

  if (!name) {
    throw new Error('Give this computer a name.');
  }

  if (!code) {
    throw new Error('Enter the pairing code shown by ORBIT Desktop Companion.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAIR_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(`${endpoint}/orbit/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Orbit-Client': `orbit-${Platform.OS}`,
      },
      body: JSON.stringify({
        code,
        client: 'orbit-mobile',
        deviceName: name,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? '1.7.0',
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      controller.signal.aborted
        ? 'The companion did not respond in time.'
        : `Could not reach the companion: ${error instanceof Error ? error.message : 'network error'}`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(
      `The companion rejected pairing (HTTP ${response.status}). Check the code and try again.`
    );
  }

  const payload = (await readJsonResponse(response)) as PairResponse;
  const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
  const token = typeof payload.token === 'string' ? payload.token.trim() : '';
  const fingerprint =
    typeof payload.fingerprint === 'string' ? payload.fingerprint.trim() : '';

  if (!deviceId || token.length < 16) {
    throw new Error('The companion returned an invalid pairing response.');
  }

  await SecureStore.setItemAsync(tokenKey(deviceId), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  const now = Date.now();
  const device: PairedDeviceRecord = {
    id: deviceId,
    userId: input.userId,
    name:
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : name,
    platform:
      typeof payload.platform === 'string' && payload.platform.trim()
        ? payload.platform.trim()
        : 'Desktop',
    endpoint,
    fingerprint: fingerprint || `sha256:${await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      token
    )}`,
    status: 'paired',
    capabilities: Array.isArray(payload.capabilities)
      ? payload.capabilities.filter((item): item is string => typeof item === 'string')
      : ['terminal', 'files'],
    pairedAt: now,
    lastSeenAt: now,
  };

  const store = new PermissionStore(input.db);
  await store.upsertDevice(device);
  permissionManager.attach(input.db);
  await permissionManager.recordAudit({
    userId: input.userId,
    event: 'device_paired',
    detail: `Paired ORBIT Desktop Companion “${device.name}”.`,
  });

  return device;
}

export async function listPairedDevices(
  db: SQLiteDatabase,
  userId: number
): Promise<PairedDeviceRecord[]> {
  return new PermissionStore(db).listDevices(userId);
}

export async function revokeCompanionDevice(
  db: SQLiteDatabase,
  userId: number,
  deviceId: string
): Promise<void> {
  const store = new PermissionStore(db);
  const device = await store.getDevice(userId, deviceId);

  await store.revokeDevice(userId, deviceId);

  try {
    await SecureStore.deleteItemAsync(tokenKey(deviceId));
  } catch {
    // A missing token is already revoked from the app's point of view.
  }

  permissionManager.attach(db);
  await permissionManager.recordAudit({
    userId,
    event: 'device_revoked',
    detail: `Revoked ${device?.name ?? 'a paired computer'}. Its session token was deleted.`,
  });
}

export async function executeCompanionCommand(input: {
  db: SQLiteDatabase;
  userId: number;
  command: string;
  cwd?: string;
  deviceId?: string;
  timeoutMs?: number;
}): Promise<CompanionExecutionResult> {
  const store = new PermissionStore(input.db);
  const devices = await store.listDevices(input.userId);
  const device = input.deviceId
    ? devices.find((entry) => entry.id === input.deviceId && entry.status === 'paired')
    : devices.find((entry) => entry.status === 'paired');

  if (!device) {
    throw new Error(
      'No paired ORBIT Desktop Companion is available. Pair a computer in Agent Permissions first.'
    );
  }

  const command = input.command.trim();

  if (!command) {
    throw new Error('A command is required.');
  }

  const blocked = blockedCommandReason(command);

  if (blocked) {
    throw new Error(blocked);
  }

  const pathError = validatePath(input.cwd ?? null);

  if (pathError) {
    throw new Error(pathError);
  }

  const token = await SecureStore.getItemAsync(tokenKey(device.id));

  if (!token) {
    throw new Error('The companion session is missing or expired. Re-pair the computer.');
  }

  const endpoint = normalizeEndpoint(device.endpoint);
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? EXECUTE_TIMEOUT_MS, 1_000), 120_000);
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), timeoutMs + 5_000);
  let timedOut = false;
  const startedAt = Date.now();

  try {
    const response = await fetch(`${endpoint}/orbit/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Orbit-Device': device.id,
      },
      body: JSON.stringify({
        command,
        cwd: input.cwd || undefined,
        timeoutMs,
        requestedAt: startedAt,
      }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('The computer rejected this session. Re-pair the companion.');
    }

    if (!response.ok) {
      throw new Error(`The computer could not run the command (HTTP ${response.status}).`);
    }

    const payload = await readJsonResponse(response);
    const exitCode =
      typeof payload.exitCode === 'number' && Number.isFinite(payload.exitCode)
        ? payload.exitCode
        : null;

    timedOut = payload.timedOut === true;

    if (payload.ok === false && typeof payload.error === 'string') {
      throw new Error(redactSecrets(payload.error));
    }

    await store.touchDevice(input.userId, device.id, Date.now());

    return {
      deviceId: device.id,
      deviceName: device.name,
      exitCode,
      stdout: truncate(
        redactSecrets(typeof payload.stdout === 'string' ? payload.stdout : ''),
        5000
      ),
      stderr: truncate(
        redactSecrets(typeof payload.stderr === 'string' ? payload.stderr : ''),
        5000
      ),
      durationMs:
        typeof payload.durationMs === 'number' ? payload.durationMs : Date.now() - startedAt,
      timedOut,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      timedOut = true;
      throw new Error('The computer did not finish before the execution timeout.');
    }

    throw error;
  } finally {
    clearTimeout(guard);
  }
}
