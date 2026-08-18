import { devPrivacyError, devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type SyncStatus = "idle" | "syncing" | "success" | "error";
const BACKEND_SYNC_ENABLED = false;

// Type definitions only - no actual imports
type NetInfoState = {
  isConnected?: boolean | null;
};

interface OnlineContextValue {
  isOnline: boolean;
  queueSize: number;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  syncNow: () => Promise<void>;
  enqueueSubmit: (params: {
    draftId: string;
    pathway: string;
    payload?: any;
  }) => Promise<void>;
}

const OnlineContext = createContext<OnlineContextValue | undefined>(undefined);

export function OnlineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [queueSize, setQueueSize] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    let unsubNet: (() => void) | undefined;
    let unsubSync: (() => void) | undefined;
    let mounted = true;

    const initializeNetworkHandling = async () => {
      try {
        // Lazy load NetInfo to avoid module-level imports
        const NetInfoModule = await import("../utils/netinfoShim");
        const NetInfo = NetInfoModule.default;
        let initialState: NetInfoState | null = null;

        if (!mounted) return;

        // Get initial state
        try {
          const state = await NetInfo.fetch();
          initialState = state;
          if (mounted) {
            setIsOnline(!!state.isConnected);
          }
        } catch {
          if (mounted) {
            setIsOnline(true); // Assume online if can't determine
          }
        }

        // Set up listener
        unsubNet = NetInfo.addEventListener((state: NetInfoState) => {
          if (mounted) {
            setIsOnline(!!state.isConnected);
          }
        });

        if (!BACKEND_SYNC_ENABLED) {
          setQueueSize(0);
          setSyncMessage(null);
          setSyncStatus("idle");
          return;
        }

        // Then lazy load offline sync manager
        const { offlineSyncManager } = await import("../utils/offlineSync");

        if (!mounted) return;

        // Initialize queue size
        setQueueSize(offlineSyncManager.getSyncQueueSize());
        setSyncMessage(offlineSyncManager.getSyncQueueRecoveryMessage());

        // Set up sync callback
        unsubSync = offlineSyncManager.addSyncCallback((status: SyncStatus) => {
          if (mounted) {
            setSyncStatus(status);
            setQueueSize(offlineSyncManager.getSyncQueueSize());
            setSyncMessage(offlineSyncManager.getSyncQueueRecoveryMessage());
          }
        });

        // If we're online and have items in queue, start sync
        const currentQueueSize = offlineSyncManager.getSyncQueueSize();
        if (initialState?.isConnected && currentQueueSize > 0) {
          offlineSyncManager.startSync().catch(() => {
            // Silently handle sync errors
          });
        }
      } catch (error) {
        devPrivacyWarn('network handling initialization failed', {
          reason: getPrivacySafeErrorReason(error),
        });
        // Continue with defaults
      }
    };

    // Start initialization
    initializeNetworkHandling();

    // Cleanup
    return () => {
      mounted = false;
      try {
        unsubNet?.();
        unsubSync?.();
      } catch {
        // Ignore cleanup errors
      }
    };
  }, []); // Only run once on mount

  const syncNow = async () => {
    if (!BACKEND_SYNC_ENABLED) {
      setQueueSize(0);
      setSyncMessage(null);
      setSyncStatus("idle");
      return;
    }

    setSyncStatus("syncing");
    try {
      const { offlineSyncManager } = await import("../utils/offlineSync");
      await offlineSyncManager.startSync(true);
      setQueueSize(offlineSyncManager.getSyncQueueSize());
      setSyncMessage(offlineSyncManager.getSyncQueueRecoveryMessage());
      setSyncStatus(offlineSyncManager.getSyncQueueSize() > 0 ? "error" : "success");
    } catch {
      try {
        const { offlineSyncManager } = await import("../utils/offlineSync");
        setQueueSize(offlineSyncManager.getSyncQueueSize());
        setSyncMessage(offlineSyncManager.getSyncQueueRecoveryMessage());
      } catch {
        // Keep the current queue state when recovery details are unavailable.
      }
      setSyncStatus("error");
    }
  };

  const enqueueSubmit = async (params: {
    draftId: string;
    pathway: string;
    payload?: any;
  }) => {
    if (!BACKEND_SYNC_ENABLED) {
      setQueueSize(0);
      setSyncMessage(null);
      setSyncStatus("idle");
      return;
    }

    try {
      const { offlineSyncManager } = await import("../utils/offlineSync");
      await offlineSyncManager.addToSyncQueue({
        id: `submit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "submit",
        data: { draftId: params.draftId, pathway: params.pathway, ...params.payload },
        maxRetries: 3,
      } as any);
      setQueueSize(offlineSyncManager.getSyncQueueSize());
      setSyncMessage(offlineSyncManager.getSyncQueueRecoveryMessage());
    } catch (error) {
      devPrivacyError('offline submission enqueue failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      throw error;
    }
  };

  const value = useMemo<OnlineContextValue>(
    () => ({
      isOnline,
      queueSize,
      syncStatus,
      syncMessage,
      syncNow,
      enqueueSubmit,
    }),
    [isOnline, queueSize, syncStatus, syncMessage]
  );

  return (
    <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
  );
}

export function useOnline() {
  const ctx = useContext(OnlineContext);
  if (!ctx) {
    throw new Error("useOnline must be used within OnlineProvider");
  }
  return ctx;
}
