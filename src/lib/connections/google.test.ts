import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  connectGoogle,
  disconnectGoogle,
  getGoogleConnectionState,
  isGoogleConnectionConfigured,
  redactConnectionText,
  sanitizeConnectionMessage,
} from './google';
import { ConnectionError } from './types';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    promptAsync: vi.fn(),
    exchangeCodeAsync: vi.fn(),
    refreshAsync: vi.fn(),
    revokeAsync: vi.fn(async () => true),
    makeRedirectUri: vi.fn(() => 'orbit://oauthredirect'),
    authRequestOptions: [] as Record<string, unknown>[],
    ResponseType: { Code: 'code' },
  };
});

vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
  deleteItemAsync: mocks.deleteItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: mocks.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}));

vi.mock('expo-auth-session', () => ({
  AuthRequest: class {
    codeVerifier = 'pkce-verifier';

    constructor(options: Record<string, unknown>) {
      mocks.authRequestOptions.push(options);
    }

    promptAsync = mocks.promptAsync;
  },
  ResponseType: mocks.ResponseType,
  makeRedirectUri: mocks.makeRedirectUri,
  exchangeCodeAsync: mocks.exchangeCodeAsync,
  refreshAsync: mocks.refreshAsync,
  revokeAsync: mocks.revokeAsync,
}));

const TOKEN_KEY = 'orbit.connection.google.1.gmail.v1';

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({}),
  } as Response;
}

describe('Google connections', () => {
  beforeEach(() => {
    mocks.store.clear();
    mocks.authRequestOptions.length = 0;
    vi.clearAllMocks();
    delete process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI;
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a setup state instead of pretending to be connected', async () => {
    expect(isGoogleConnectionConfigured()).toBe(false);

    const state = await getGoogleConnectionState(1, 'gmail', false);

    expect(state.status).toBe('not_configured');
    expect(state.configured).toBe(false);
    expect(state.email).toBeNull();
  });

  it('reports disconnected when no token is stored and OAuth is configured', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = 'client.apps.googleusercontent.com';

    const state = await getGoogleConnectionState(1, 'gmail', false);

    expect(state.configured).toBe(true);
    expect(state.status).toBe('disconnected');
  });

  it('reports expired credentials when an old token cannot be refreshed', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = 'client.apps.googleusercontent.com';
    mocks.store.set(
      TOKEN_KEY,
      JSON.stringify({
        accessToken: 'old-token',
        refreshToken: null,
        expiresAt: Date.now() - 1000,
        scope: '',
        tokenType: 'Bearer',
        email: 'user@example.com',
        lastError: null,
        updatedAt: Date.now() - 10_000,
      })
    );

    const state = await getGoogleConnectionState(1, 'gmail', false);

    expect(state.status).toBe('expired');
    expect(state.detail).toContain('Reconnect');
  });

  it('exchanges a real authorization code and stores the token only after success', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = 'client.apps.googleusercontent.com';
    mocks.promptAsync.mockResolvedValue({
      type: 'success',
      params: { code: 'auth-code-1' },
    });
    mocks.exchangeCodeAsync.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      tokenType: 'Bearer',
    });

    const state = await connectGoogle(1, 'gmail');

    expect(state.status).toBe('connected');
    expect(mocks.authRequestOptions[0]).toMatchObject({
      clientId: 'client.apps.googleusercontent.com',
      responseType: 'code',
      usePKCE: true,
    });
    expect(mocks.exchangeCodeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth-code-1',
        extraParams: { code_verifier: 'pkce-verifier' },
      }),
      expect.any(Object)
    );
    expect(mocks.store.get(TOKEN_KEY)).toContain('access-token');
  });

  it('treats a cancelled OAuth prompt as an explicit cancellation', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = 'client.apps.googleusercontent.com';
    mocks.promptAsync.mockResolvedValue({ type: 'cancel' });

    await expect(connectGoogle(1, 'gmail')).rejects.toMatchObject({
      kind: 'cancelled',
    } satisfies Partial<ConnectionError>);
    expect(mocks.store.has(TOKEN_KEY)).toBe(false);
  });

  it('revokes and removes the stored token on disconnect', async () => {
    process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID = 'client.apps.googleusercontent.com';
    mocks.store.set(
      TOKEN_KEY,
      JSON.stringify({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 60_000,
        scope: '',
        tokenType: 'Bearer',
        email: null,
        lastError: null,
        updatedAt: Date.now(),
      })
    );

    const result = await disconnectGoogle(1, 'gmail');

    expect(result.revoked).toBe(true);
    expect(mocks.store.has(TOKEN_KEY)).toBe(false);
  });

  it('redacts secret-like values from user-visible messages', () => {
    expect(
      sanitizeConnectionMessage('Bearer abc123 token=secret-value password: hunter2')
    ).toBe('Bearer [redacted] token=[redacted] password=[redacted]');
  });

  it('keeps full connection content while redacting secret-like values', () => {
    const body = `Meeting notes ${'x'.repeat(1_000)}\napi_key: super-secret`;
    const redacted = redactConnectionText(body);

    expect(redacted.length).toBeGreaterThan(1_000);
    expect(redacted).toContain('x'.repeat(1_000));
    expect(redacted).toContain('api_key=[redacted]');
    expect(redacted).not.toContain('super-secret');
  });
});
