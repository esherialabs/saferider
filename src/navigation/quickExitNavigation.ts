import { SCREEN_NAMES } from './routes';

export type QuickExitResetState = {
  index: number;
  routes: Array<{ name: typeof SCREEN_NAMES.CALCULATOR }>;
};

export const QUICK_EXIT_RESET_STATE: QuickExitResetState = {
  index: 0,
  routes: [{ name: SCREEN_NAMES.CALCULATOR }],
};

type QuickExitNavigationTarget = {
  getParent?: () => unknown;
  resetRoot?: (state: QuickExitResetState) => void;
  reset?: (state: QuickExitResetState) => void;
  dispatch?: (action: { type: 'RESET'; payload: QuickExitResetState }) => void;
};

export type QuickExitUnlockGuard = () => boolean | Promise<boolean>;

function asQuickExitNavigationTarget(value: unknown): QuickExitNavigationTarget | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as QuickExitNavigationTarget;
}

export function createQuickExitResetAction() {
  return {
    type: 'RESET' as const,
    payload: QUICK_EXIT_RESET_STATE,
  };
}

export function resetToCalculatorDecoy(navigation: unknown): boolean {
  const target = asQuickExitNavigationTarget(navigation);
  const parent = asQuickExitNavigationTarget(target?.getParent?.());
  const rootNavigation = parent ?? target;

  if (!rootNavigation) {
    return false;
  }

  if (typeof rootNavigation.resetRoot === 'function') {
    rootNavigation.resetRoot(QUICK_EXIT_RESET_STATE);
    return true;
  }

  if (typeof rootNavigation.reset === 'function') {
    rootNavigation.reset(QUICK_EXIT_RESET_STATE);
    return true;
  }

  if (typeof rootNavigation.dispatch === 'function') {
    rootNavigation.dispatch(createQuickExitResetAction());
    return true;
  }

  return false;
}

export async function resetToCalculatorDecoyIfUnlockable(
  navigation: unknown,
  isCalculatorUnlockable: QuickExitUnlockGuard,
): Promise<boolean> {
  let canUnlock = false;

  try {
    canUnlock = await isCalculatorUnlockable();
  } catch {
    canUnlock = false;
  }

  if (!canUnlock) {
    return false;
  }

  return resetToCalculatorDecoy(navigation);
}
