import { useEffect } from 'react';

export type AppResetReason = 'sign-out' | 'session-expired' | 'user-switch' | 'privacy-delete';

type ResetHandler = (reason: AppResetReason) => void | Promise<void>;

const handlers = new Set<ResetHandler>();

export function registerAppResetHandler(handler: ResetHandler) {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export async function runAppReset(reason: AppResetReason): Promise<void> {
  const executions = Array.from(handlers).map(async (handler) => {
    try {
      await handler(reason);
    } catch (error) {
      console.warn('[appReset] handler failed', error);
    }
  });

  await Promise.allSettled(executions);
}

/**
 * Hook helper for React components that need to clear local state whenever
 * the global app reset event fires (typically on sign-out).
 */
export function useAppReset(handler: ResetHandler, reasonFilter?: AppResetReason | AppResetReason[]) {
  useEffect(() => {
    const reasons = Array.isArray(reasonFilter) ? reasonFilter : reasonFilter ? [reasonFilter] : null;

    const wrapped: ResetHandler = (reason) => {
      if (reasons && !reasons.includes(reason)) {
        return;
      }
      return handler(reason);
    };

    return registerAppResetHandler(wrapped);
  }, [handler, reasonFilter]);
}
