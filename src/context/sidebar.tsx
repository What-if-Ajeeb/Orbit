import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { Keyboard } from 'react-native';

type SidebarContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: PropsWithChildren) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => {
    Keyboard.dismiss();
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarContextValue {
  const value = useContext(SidebarContext);

  if (!value) {
    throw new Error('useSidebar must be used inside a <SidebarProvider />');
  }

  return value;
}
