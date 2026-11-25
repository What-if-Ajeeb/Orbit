import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { usePluginSnapshot } from '@/context/plugins';
import {
  BOTTOM_NAV_DEFAULT_IDS,
  BOTTOM_NAV_SLOT_COUNT,
  buildNavDestinations,
  normalizeNavIds,
  resolveNavSlots,
  unavailableNavIds,
  type BottomNavDestination,
  type BottomNavSlot,
} from '@/lib/bottom-navigation';
import {
  clearBottomNavIds,
  loadBottomNavIds,
  saveBottomNavIds,
} from '@/lib/bottom-navigation-storage';

type BottomNavigationContextValue = {
  savedIds: string[];
  draftIds: string[];
  slots: BottomNavSlot[];
  draftSlots: BottomNavSlot[];
  destinations: BottomNavDestination[];
  unavailableIds: string[];
  hasChanges: boolean;
  setDraftSlot: (index: number, destinationId: string) => void;
  moveDraftSlot: (from: number, to: number) => void;
  saveDraft: () => Promise<void>;
  discardDraft: () => void;
  restoreDefaults: () => Promise<void>;
};

const defaultIds = [...BOTTOM_NAV_DEFAULT_IDS];

const BottomNavigationContext = createContext<BottomNavigationContextValue | null>(null);

export function BottomNavigationProvider({ children }: PropsWithChildren) {
  const { navigation } = usePluginSnapshot();
  const [savedIds, setSavedIds] = useState<string[]>(defaultIds);
  const [draftIds, setDraftIds] = useState<string[]>(defaultIds);

  const destinations = useMemo(() => buildNavDestinations(navigation), [navigation]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const stored = await loadBottomNavIds();

      if (active) {
        setSavedIds(stored);
        setDraftIds(stored);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const slots = useMemo(() => resolveNavSlots(savedIds, destinations), [savedIds, destinations]);
  const draftSlots = useMemo(
    () => resolveNavSlots(draftIds, destinations),
    [draftIds, destinations]
  );
  const unavailableIds = useMemo(
    () => unavailableNavIds(savedIds, destinations),
    [savedIds, destinations]
  );
  const hasChanges = draftIds.join('|') !== savedIds.join('|');

  const setDraftSlot = useCallback(
    (index: number, destinationId: string) => {
      if (index < 0 || index >= BOTTOM_NAV_SLOT_COUNT) {
        return;
      }

      if (!destinations.some((destination) => destination.id === destinationId)) {
        return;
      }

      setDraftIds((current) => {
        const next = [...current];
        const previousForIndex = next[index] ?? defaultIds[index];
        const otherIndex = next.indexOf(destinationId);

        // Swapping keeps the three destinations unique even when the user picks
        // an ID that is already assigned to another slot.
        if (otherIndex >= 0 && otherIndex !== index) {
          next[otherIndex] = previousForIndex;
        }

        next[index] = destinationId;
        return next;
      });
    },
    [destinations]
  );

  const moveDraftSlot = useCallback((from: number, to: number) => {
    if (from < 0 || to < 0 || from >= BOTTOM_NAV_SLOT_COUNT || to >= BOTTOM_NAV_SLOT_COUNT) {
      return;
    }

    setDraftIds((current) => {
      const next = [...current];
      const moved = next[from];
      next[from] = next[to];
      next[to] = moved;
      return next;
    });
  }, []);

  const saveDraft = useCallback(async () => {
    const normalized = normalizeNavIds(draftIds, destinations);
    const stored = await saveBottomNavIds(normalized);

    setSavedIds(stored);
    setDraftIds(stored);
  }, [draftIds, destinations]);

  const discardDraft = useCallback(() => {
    setDraftIds(savedIds);
  }, [savedIds]);

  const restoreDefaults = useCallback(async () => {
    await clearBottomNavIds();

    setSavedIds(defaultIds);
    setDraftIds(defaultIds);
  }, []);

  const value = useMemo<BottomNavigationContextValue>(
    () => ({
      savedIds,
      draftIds,
      slots,
      draftSlots,
      destinations,
      unavailableIds,
      hasChanges,
      setDraftSlot,
      moveDraftSlot,
      saveDraft,
      discardDraft,
      restoreDefaults,
    }),
    [
      savedIds,
      draftIds,
      slots,
      draftSlots,
      destinations,
      unavailableIds,
      hasChanges,
      setDraftSlot,
      moveDraftSlot,
      saveDraft,
      discardDraft,
      restoreDefaults,
    ]
  );

  return (
    <BottomNavigationContext.Provider value={value}>{children}</BottomNavigationContext.Provider>
  );
}

export function useBottomNavigation(): BottomNavigationContextValue {
  const context = useContext(BottomNavigationContext);

  if (!context) {
    throw new Error('useBottomNavigation must be used inside BottomNavigationProvider.');
  }

  return context;
}
