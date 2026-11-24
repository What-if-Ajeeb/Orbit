import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import {
  ConnectionError,
  type ConnectionState,
  type GoogleConnectionId,
  type ConnectionStatus,
} from './types';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOCATION_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const REFRESH_MARGIN_MS = 60_000;
const API_TIMEOUT_MS = 20_000;

const CONNECTION_META: Record<
  GoogleConnectionId,
  { label: string; description: string; scopes: string[]; verifyUrl: string }
> = {
  gmail: {
    label: 'Gmail',
    description: 'Search, read, draft and send mail with approval.',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
    ],
    verifyUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
  },
  google_calendar: {
    label: 'Google Calendar',
    description: 'Find events and create or change events with approval.',
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    verifyUrl: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1',
  },
  google_drive: {
    label: 'Google Drive',
    description: 'Search and read permitted files; manage files with approval.',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',
    ],
    verifyUrl: 'https://www.googleapis.com/drive/v3/about?fields=user',
  },
};

export type GoogleConfig = {
  clientId: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
};

type StoredGoogleToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  tokenType: string;
  email: string | null;
  lastError: string | null;
  updatedAt: number;
};

type TokenLike = {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresIn?: number | null;
  scope?: string | null;
  tokenType?: string | null;
};

/** Redacts bearer tokens and secret-like assignments without changing content length. */
export function redactConnectionText(input: string): string {
  return input
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(
      /(token|secret|password|passwd|api[-_]?key|authorization)\s*[:=]\s*([^,\s&]+)/gi,
      '$1=[redacted]'
    );
}

/** Redacts and bounds error detail for logs and UI messages. */
export function sanitizeConnectionMessage(input: string, maxLength = 400): string {
  return redactConnectionText(input).slice(0, maxLength);
}

function getEnv(name: string): string {
  const value = (process.env as Record<string, string | undefined>)?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = getEnv('EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID') || getEnv('EXPO_PUBLIC_GOOGLE_CLIENT_ID');

  if (!clientId) {
    return null;
  }

  const redirectUri =
    getEnv('EXPO_PUBLIC_GOOGLE_REDIRECT_URI') ||
    AuthSession.makeRedirectUri({ scheme: 'orbit', path: 'oauthredirect' });

  return {
    clientId,
    redirectUri,
    authorizationEndpoint: AUTHORIZATION_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    revocationEndpoint: REVOCATION_ENDPOINT,
  };
}

export function isGoogleConnectionConfigured(): boolean {
  return getGoogleConfig() !== null;
}

export function connectionLabel(id: GoogleConnectionId): string {
  return CONNECTION_META[id].label;
}

export function connectionScopes(id: GoogleConnectionId): string[] {
  return [...CONNECTION_META[id].scopes];
}

function storageKey(userId: number, id: GoogleConnectionId): string {
  return `orbit.connection.google.${userId}.${id}.v1`;
}

async function readStoredToken(
  userId: number,
  id: GoogleConnectionId
): Promise<StoredGoogleToken | null> {
  const raw = await SecureStore.getItemAsync(storageKey(userId, id));

  if (!raw) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.accessToken !== 'string' || !record.accessToken) {
      return null;
    }

    return {
      accessToken: record.accessToken,
      refreshToken:
        typeof record.refreshToken === 'string' && record.refreshToken
          ? record.refreshToken
          : null,
      expiresAt:
        typeof record.expiresAt === 'number' && Number.isFinite(record.expiresAt)
          ? record.expiresAt
          : 0,
      scope: typeof record.scope === 'string' ? record.scope : '',
      tokenType: typeof record.tokenType === 'string' ? record.tokenType : 'Bearer',
      email: typeof record.email === 'string' ? record.email : null,
      lastError: typeof record.lastError === 'string' ? record.lastError : null,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

async function writeStoredToken(
  userId: number,
  id: GoogleConnectionId,
  token: StoredGoogleToken
): Promise<void> {
  await SecureStore.setItemAsync(storageKey(userId, id), JSON.stringify(token), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteStoredToken(userId: number, id: GoogleConnectionId): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(userId, id));
}

function toStoredToken(
  id: GoogleConnectionId,
  token: TokenLike,
  previous: StoredGoogleToken | null
): StoredGoogleToken {
  const accessToken = token.accessToken?.trim();

  if (!accessToken) {
    throw new ConnectionError('api', 'Google did not return an access token.');
  }

  return {
    accessToken,
    refreshToken: token.refreshToken?.trim() || previous?.refreshToken || null,
    expiresAt:
      typeof token.expiresIn === 'number' && Number.isFinite(token.expiresIn)
        ? Date.now() + token.expiresIn * 1000
        : 0,
    scope: token.scope?.trim() || previous?.scope || connectionScopes(id).join(' '),
    tokenType: token.tokenType?.trim() || 'Bearer',
    email: previous?.email ?? null,
    lastError: null,
    updatedAt: Date.now(),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ConnectionError('network', 'Google did not respond in time. Try again.');
    }

    throw new ConnectionError('network', 'Could not reach Google. Check your connection.');
  } finally {
    clearTimeout(timeout);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const raw = await response.text();
    const parsed: unknown = JSON.parse(raw);
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
    const error = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : record;
    const message =
      typeof error.message === 'string'
        ? error.message
        : typeof error.error_description === 'string'
          ? error.error_description
          : raw;

    return sanitizeConnectionMessage(message || `Google returned HTTP ${response.status}.`);
  } catch {
    return `Google returned HTTP ${response.status}.`;
  }
}

function statusFromResponse(response: Response, detail: string): ConnectionError {
  if (response.status === 401) {
    return new ConnectionError('expired', `Google sign-in expired. Reconnect to continue. ${detail}`);
  }

  if (response.status === 403) {
    return new ConnectionError(
      'forbidden',
      `Google denied access. Check the enabled API and granted scopes. ${detail}`
    );
  }

  return new ConnectionError('api', detail);
}

async function apiFetchWithToken(
  id: GoogleConnectionId,
  token: StoredGoogleToken,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `${token.tokenType || 'Bearer'} ${token.accessToken}`);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchWithTimeout(url, { ...init, headers });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw statusFromResponse(response, detail);
  }

  return response;
}

async function verifyToken(id: GoogleConnectionId, token: StoredGoogleToken): Promise<void> {
  await apiFetchWithToken(id, token, CONNECTION_META[id].verifyUrl);
}

function needsRefresh(token: StoredGoogleToken): boolean {
  return token.expiresAt > 0 && token.expiresAt <= Date.now() + REFRESH_MARGIN_MS;
}

async function refreshToken(
  userId: number,
  id: GoogleConnectionId,
  token: StoredGoogleToken,
  config: GoogleConfig
): Promise<StoredGoogleToken> {
  if (!token.refreshToken) {
    throw new ConnectionError('expired', 'Google sign-in expired. Reconnect to continue.', id);
  }

  try {
    const refreshed = await AuthSession.refreshAsync(
      {
        clientId: config.clientId,
        refreshToken: token.refreshToken,
      },
      { tokenEndpoint: config.tokenEndpoint }
    );

    const next = toStoredToken(id, refreshed, token);
    await writeStoredToken(userId, id, next);
    return next;
  } catch (error) {
    if (error instanceof ConnectionError) {
      throw error;
    }

    const detail = sanitizeConnectionMessage(error instanceof Error ? error.message : 'Unknown error');
    throw new ConnectionError('expired', `Google sign-in expired. Reconnect to continue. ${detail}`, id);
  }
}

async function resolveToken(
  userId: number,
  id: GoogleConnectionId
): Promise<StoredGoogleToken | null> {
  const token = await readStoredToken(userId, id);

  if (!token) {
    return null;
  }

  const config = getGoogleConfig();

  if (!config) {
    throw new ConnectionError('not_configured', 'Google OAuth is not configured in this build.', id);
  }

  if (needsRefresh(token)) {
    return refreshToken(userId, id, token, config);
  }

  return token;
}

/** Internal only: callers use googleApiFetch so the token never leaves this module. */
async function getAuthorizedToken(
  userId: number,
  id: GoogleConnectionId
): Promise<StoredGoogleToken> {
  const token = await resolveToken(userId, id);

  if (!token) {
    throw new ConnectionError('unauthorized', `${connectionLabel(id)} is not connected.`, id);
  }

  return token;
}

export async function googleApiFetch(
  userId: number,
  id: GoogleConnectionId,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAuthorizedToken(userId, id);
  return apiFetchWithToken(id, token, url, init);
}

export async function googleApiJson<T>(
  userId: number,
  id: GoogleConnectionId,
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await googleApiFetch(userId, id, url, init);

  try {
    return (await response.json()) as T;
  } catch {
    throw new ConnectionError('api', 'Google returned an invalid response.');
  }
}

export async function connectGoogle(userId: number, id: GoogleConnectionId): Promise<ConnectionState> {
  const config = getGoogleConfig();

  if (!config) {
    throw new ConnectionError(
      'not_configured',
      'Add EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID (and optional redirect URI) before connecting.',
      id
    );
  }

  const request = new AuthSession.AuthRequest({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: CONNECTION_META[id].scopes,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync({ authorizationEndpoint: config.authorizationEndpoint });

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new ConnectionError('cancelled', 'Google sign-in was cancelled.', id);
  }

  if (result.type !== 'success' || !result.params?.code) {
    const detail = sanitizeConnectionMessage(
      result.type === 'error' && typeof result.error === 'string'
        ? result.error
        : 'Google sign-in failed.'
    );
    throw new ConnectionError('unauthorized', detail, id);
  }

  const exchanged = await AuthSession.exchangeCodeAsync(
    {
      clientId: config.clientId,
      code: result.params.code,
      redirectUri: config.redirectUri,
      ...(request.codeVerifier
        ? { extraParams: { code_verifier: request.codeVerifier } }
        : {}),
    },
    { tokenEndpoint: config.tokenEndpoint }
  );

  const stored = toStoredToken(id, exchanged, null);
  await writeStoredToken(userId, id, stored);

  try {
    await verifyToken(id, stored);
  } catch (error) {
    await deleteStoredToken(userId, id);
    throw error;
  }

  return getGoogleConnectionState(userId, id, false);
}

export async function disconnectGoogle(
  userId: number,
  id: GoogleConnectionId
): Promise<{ revoked: boolean; detail: string | null }> {
  const token = await readStoredToken(userId, id);
  let revoked = false;
  let detail: string | null = null;
  const config = getGoogleConfig();
  const revokeToken = token?.refreshToken || token?.accessToken;

  if (config && revokeToken) {
    try {
      revoked = await AuthSession.revokeAsync(
        { clientId: config.clientId, token: revokeToken },
        { revocationEndpoint: config.revocationEndpoint }
      );
    } catch (error) {
      detail = sanitizeConnectionMessage(
        error instanceof Error ? error.message : 'Google revocation failed.'
      );
    }
  }

  await deleteStoredToken(userId, id);

  return {
    revoked,
    detail: detail ? `Removed on this device. ${detail}` : null,
  };
}

export async function clearGoogleConnections(userId: number): Promise<void> {
  await Promise.all(
    (Object.keys(CONNECTION_META) as GoogleConnectionId[]).map((id) =>
      deleteStoredToken(userId, id)
    )
  );
}

function statusForError(error: unknown): { status: ConnectionStatus; detail: string } {
  if (error instanceof ConnectionError) {
    if (error.kind === 'expired') {
      return { status: 'expired', detail: error.message };
    }

    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      return { status: 'error', detail: error.message };
    }

    return { status: 'error', detail: error.message };
  }

  return {
    status: 'error',
    detail: sanitizeConnectionMessage(error instanceof Error ? error.message : 'Unknown error'),
  };
}

export async function getGoogleConnectionState(
  userId: number,
  id: GoogleConnectionId,
  verify = true
): Promise<ConnectionState> {
  const meta = CONNECTION_META[id];
  const config = getGoogleConfig();
  const base = {
    id,
    label: meta.label,
    description: meta.description,
    configured: Boolean(config),
    expiresAt: null,
    lastCheckedAt: null,
    email: null,
    scopes: meta.scopes,
    detail: null,
  };

  if (!config) {
    return {
      ...base,
      status: 'not_configured',
      detail: 'Set EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID to enable this integration.',
    };
  }

  try {
    const token = await resolveToken(userId, id);

    if (!token) {
      return {
        ...base,
        status: 'disconnected',
        scopes: meta.scopes,
      };
    }

    const state: ConnectionState = {
      ...base,
      status: 'connected',
      scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : meta.scopes,
      expiresAt: token.expiresAt || null,
      lastCheckedAt: Date.now(),
      email: token.email,
      detail: token.lastError,
    };

    if (verify) {
      await verifyToken(id, token);
    }

    return state;
  } catch (error) {
    const mapped = statusForError(error);
    return {
      ...base,
      status: mapped.status,
      detail: mapped.detail,
    };
  }
}

export async function listGoogleConnectionStates(
  userId: number,
  verify = true
): Promise<ConnectionState[]> {
  const states = await Promise.all(
    (Object.keys(CONNECTION_META) as GoogleConnectionId[]).map((id) =>
      getGoogleConnectionState(userId, id, verify)
    )
  );

  return states;
}

/** Used by tool metadata (not by plugin JavaScript). */
export function requiredScopesForTool(
  id: GoogleConnectionId,
  action: 'read' | 'write'
): string[] {
  const scopes = connectionScopes(id);

  return action === 'read' ? scopes.slice(0, 1) : scopes;
}
