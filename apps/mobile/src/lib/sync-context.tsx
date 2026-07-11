import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getSyncPill,
  refreshSyncPill,
  runSyncPass,
  startSyncEngine,
  subscribeSyncPill,
  type SyncPillState,
} from './sync';

interface SyncContextValue {
  pill: SyncPillState;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [pill, setPill] = useState<SyncPillState>(getSyncPill());

  useEffect(() => {
    const unsub = subscribeSyncPill(setPill);
    void startSyncEngine();
    return unsub;
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({
      pill,
      refresh: async () => {
        await refreshSyncPill();
      },
      syncNow: async () => {
        await runSyncPass({ notify: true });
      },
    }),
    [pill],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    return {
      pill: { kind: 'idle' },
      refresh: async () => undefined,
      syncNow: async () => undefined,
    };
  }
  return ctx;
}
