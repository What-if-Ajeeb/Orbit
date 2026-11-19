import { getRandomBytes } from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { SQLiteDatabase } from 'expo-sqlite';

import { isValidEmail, normalizeEmail } from './validation';

export const MIN_PASSWORD_LENGTH = 8;

const PBKDF2_ITERATIONS = 120_000;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type User = {
  id: number;
  name: string;
  email: string;
  createdAt: number;
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  created_at: number;
};

type UserWithPasswordRow = UserRow & {
  password_hash: string;
  password_salt: string;
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const hash = await pbkdf2Async(sha256, utf8ToBytes(password), hexToBytes(saltHex), {
    c: PBKDF2_ITERATIONS,
    dkLen: 32,
  });
  return bytesToHex(hash);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function hashSessionToken(token: string): string {
  return bytesToHex(sha256(utf8ToBytes(token)));
}

async function createSession(db: SQLiteDatabase, userId: number): Promise<string> {
  const token = bytesToHex(getRandomBytes(32));
  const now = Date.now();

  await db.runAsync('DELETE FROM sessions WHERE expires_at <= ?', now);
  await db.runAsync(
    'INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)',
    userId,
    hashSessionToken(token),
    now,
    now + SESSION_DURATION_MS
  );

  return token;
}

export type SignUpInput = {
  name: string;
  email: string;
  password: string;
};

export type SignInInput = {
  email: string;
  password: string;
};

export async function signUpWithEmail(
  db: SQLiteDatabase,
  input: SignUpInput
): Promise<{ user: User; token: string }> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);

  if (name.length < 2) {
    throw new AuthError('Please enter your name.');
  }

  if (!isValidEmail(email)) {
    throw new AuthError('Enter a valid email address.');
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM users WHERE email = ?',
    email
  );

  if (existing) {
    throw new AuthError('An account with this email already exists.');
  }

  const salt = bytesToHex(getRandomBytes(16));
  const passwordHash = await hashPassword(input.password, salt);
  const createdAt = Date.now();

  const result = await db.runAsync(
    'INSERT INTO users (name, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
    name,
    email,
    passwordHash,
    salt,
    createdAt
  );

  const user: User = {
    id: result.lastInsertRowId,
    name,
    email,
    createdAt,
  };

  const token = await createSession(db, user.id);
  return { user, token };
}

export async function signInWithEmail(
  db: SQLiteDatabase,
  input: SignInInput
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(input.email);

  if (!isValidEmail(email) || input.password.length === 0) {
    throw new AuthError('Enter your email and password.');
  }

  const row = await db.getFirstAsync<UserWithPasswordRow>(
    'SELECT id, name, email, password_hash, password_salt, created_at FROM users WHERE email = ?',
    email
  );

  if (!row) {
    throw new AuthError('Email or password is incorrect.');
  }

  const candidateHash = await hashPassword(input.password, row.password_salt);

  if (!constantTimeEqual(candidateHash, row.password_hash)) {
    throw new AuthError('Email or password is incorrect.');
  }

  const user = toUser(row);
  const token = await createSession(db, user.id);
  return { user, token };
}

export async function getUserForSession(
  db: SQLiteDatabase,
  token: string
): Promise<User | null> {
  const row = await db.getFirstAsync<UserRow>(
    `SELECT u.id, u.name, u.email, u.created_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    hashSessionToken(token),
    Date.now()
  );

  return row ? toUser(row) : null;
}

export async function destroySession(db: SQLiteDatabase, token: string): Promise<void> {
  await db.runAsync('DELETE FROM sessions WHERE token_hash = ?', hashSessionToken(token));
}
