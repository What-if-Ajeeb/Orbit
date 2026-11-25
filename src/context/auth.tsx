import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  destroySession,
  getUserForSession,
  listLocalAccounts,
  signInWithEmail,
  signUpWithEmail,
  switchAccount as switchAccountWithId,
  type SignUpInput,
  type User,
} from '@/lib/auth';
import {
  clearStoredSessionToken,
  getStoredSessionToken,
  setStoredSessionToken,
} from '@/lib/session-storage';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  accounts: User[];
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
  switchAccount: (userId: number) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await listLocalAccounts(db);
      setAccounts(list);
    } catch (error) {
      console.warn('Could not load local accounts.', error);
    }
  }, [db]);

  useEffect(() => {
    let isActive = true;

    async function restoreSession() {
      try {
        const token = await getStoredSessionToken();

        if (!token) {
          return;
        }

        const sessionUser = await getUserForSession(db, token);

        if (!sessionUser) {
          await clearStoredSessionToken();
          return;
        }

        if (isActive) {
          setUser(sessionUser);
        }
      } catch (error) {
        console.warn('Could not restore the local session.', error);
      } finally {
        if (isActive) {
          setIsLoading(false);
          await refreshAccounts();
        }
      }
    }

    restoreSession();

    return () => {
      isActive = false;
    };
  }, [db, refreshAccounts]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await signInWithEmail(db, { email, password });
      await setStoredSessionToken(result.token);
      setUser(result.user);
      await refreshAccounts();
    },
    [db, refreshAccounts]
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const result = await signUpWithEmail(db, input);
      await setStoredSessionToken(result.token);
      setUser(result.user);
      await refreshAccounts();
    },
    [db, refreshAccounts]
  );

  const signOut = useCallback(async () => {
    const token = await getStoredSessionToken();

    if (token) {
      await destroySession(db, token);
    }

    await clearStoredSessionToken();
    setUser(null);
  }, [db]);

  const switchAccount = useCallback(
    async (userId: number) => {
      const result = await switchAccountWithId(db, userId);
      await setStoredSessionToken(result.token);
      setUser(result.user);
    },
    [db]
  );

  const value = useMemo(
    () => ({ user, isLoading, accounts, signIn, signUp, signOut, switchAccount }),
    [user, isLoading, accounts, signIn, signUp, signOut, switchAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useSession must be used inside a <SessionProvider />');
  }

  return value;
}
