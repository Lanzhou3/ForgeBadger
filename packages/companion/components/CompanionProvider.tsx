import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { CompanionClient, type CompanionClientState } from '../src/client/CompanionClient';
import { ExpoPlatform } from '../src/native/ExpoPlatform';
import type { CompanionCommandReceipt } from '../src/client/protocol';

interface CompanionContextValue {
  state: CompanionClientState;
  refreshing: boolean;
  pair(rawQr: string, deviceName: string): Promise<void>;
  executeCommand(type: string, payload: unknown): Promise<CompanionCommandReceipt>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
}

const CompanionContext = createContext<CompanionContextValue | null>(null);

export function CompanionProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<CompanionClient | null>(null);
  if (!clientRef.current) clientRef.current = new CompanionClient(new ExpoPlatform());
  const client = clientRef.current;
  const [state, setState] = useState<CompanionClientState>(client.getState());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = client.subscribe(setState);
    void client.restore().catch(() => undefined);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void client.refresh().catch(() => undefined);
    });
    return () => {
      subscription.remove();
      unsubscribe();
      client.close();
    };
  }, [client]);

  const value = useMemo<CompanionContextValue>(() => ({
    state,
    refreshing,
    pair: async (rawQr, deviceName) => client.pair(rawQr, deviceName),
    executeCommand: async (type, payload) => client.executeCommand(type, payload),
    refresh: async () => {
      setRefreshing(true);
      try { await client.refresh(); } finally { setRefreshing(false); }
    },
    logout: async () => client.logout()
  }), [client, state, refreshing]);

  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}

export function useCompanion(): CompanionContextValue {
  const value = useContext(CompanionContext);
  if (!value) throw new Error('CompanionProvider is required');
  return value;
}
