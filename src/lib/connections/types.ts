export type GoogleConnectionId = 'gmail' | 'google_calendar' | 'google_drive';

export type ConnectionStatus =
  | 'not_configured'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

export type ConnectionState = {
  id: GoogleConnectionId;
  label: string;
  description: string;
  status: ConnectionStatus;
  configured: boolean;
  email: string | null;
  scopes: string[];
  expiresAt: number | null;
  lastCheckedAt: number | null;
  detail: string | null;
};

export type ConnectionErrorKind =
  | 'cancelled'
  | 'not_configured'
  | 'expired'
  | 'unauthorized'
  | 'forbidden'
  | 'api'
  | 'network'
  | 'storage';

export class ConnectionError extends Error {
  kind: ConnectionErrorKind;
  provider: GoogleConnectionId | null;

  constructor(
    kind: ConnectionErrorKind,
    message: string,
    provider: GoogleConnectionId | null = null
  ) {
    super(message);
    this.name = 'ConnectionError';
    this.kind = kind;
    this.provider = provider;
  }
}

export const GOOGLE_CONNECTION_IDS: GoogleConnectionId[] = [
  'gmail',
  'google_calendar',
  'google_drive',
];
