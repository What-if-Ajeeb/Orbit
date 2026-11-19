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
  signInWithEmail,
  signUpWithEmail,
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
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
        }
      }
    }

    restoreSession();

    return () => {
      isActive = false;
    };
  }, [db]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await signInWithEmail(db, { email, password });
      await setStoredSessionToken(result.token);
      setUser(result.user);
    },
    [db]
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const result = await signUpWithEmail(db, input);
      await setStoredSessionToken(result.token);
      setUser(result.user);
    },
    [db]
  );

  const signOut = useCallback(async () => {
    const token = await getStoredSessionToken();

    if (token) {
      await destroySession(db, token);
    }

    await clearStoredSessionToken();
    setUser(null);
  }, [db]);

  const value = useMemo(
    () => ({ user, isLoading, signIn, signUp, signOut }),
    [user, isLoading, signIn, signUp, signOut]
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
