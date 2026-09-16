export type NavigationGuardRegistration = {
  id: string;
  message: string;
  onLeave: () => void;
};

export type NavigationGuardController = {
  clear: (id: string) => void;
  set: (registration: NavigationGuardRegistration) => void;
};

declare global {
  interface Window {
    __FIELD_ATLAS_NAVIGATION_GUARD__?: NavigationGuardController;
  }
}

/**
 * Installs before Next's router so a guarded history traversal can be stopped
 * before the current route unmounts. The index is deliberately stored beside
 * (rather than instead of) Next's history state.
 */
export function installNavigationGuard() {
  if (window.__FIELD_ATLAS_NAVIGATION_GUARD__) return;

  const historyIndexKey = '__fieldAtlasHistoryIndex';
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  let registration: NavigationGuardRegistration | null = null;
  let restoringIndex: number | null = null;

  function readIndex(state: unknown) {
    if (!state || typeof state !== 'object') return null;
    const value = (state as Record<string, unknown>)[historyIndexKey];
    return Number.isSafeInteger(value) ? (value as number) : null;
  }

  function withIndex(state: unknown, index: number) {
    const record =
      state && typeof state === 'object' && !Array.isArray(state)
        ? (state as Record<string, unknown>)
        : {};
    return { ...record, [historyIndexKey]: index };
  }

  let currentIndex = readIndex(window.history.state) ?? 0;
  originalReplaceState.call(
    window.history,
    withIndex(window.history.state, currentIndex),
    '',
    window.location.href,
  );

  window.history.pushState = function pushState(state, unused, url) {
    const nextIndex = currentIndex + 1;
    const result = originalPushState.call(
      window.history,
      withIndex(state, nextIndex),
      unused,
      url,
    );
    currentIndex = nextIndex;
    return result;
  };

  window.history.replaceState = function replaceState(state, unused, url) {
    return originalReplaceState.call(
      window.history,
      withIndex(state, currentIndex),
      unused,
      url,
    );
  };

  const handlePopState = (event: PopStateEvent) => {
    const previousIndex = currentIndex;
    const targetIndex = readIndex(event.state);
    if (targetIndex !== null) currentIndex = targetIndex;

    if (restoringIndex !== null) {
      event.stopImmediatePropagation();
      if (targetIndex === restoringIndex) restoringIndex = null;
      return;
    }

    if (
      !registration ||
      targetIndex === null ||
      targetIndex === previousIndex
    ) {
      return;
    }

    if (window.confirm(registration.message)) {
      const acceptedRegistration = registration;
      registration = null;
      acceptedRegistration.onLeave();
      return;
    }

    event.stopImmediatePropagation();
    restoringIndex = previousIndex;
    window.history.go(previousIndex - targetIndex);
  };

  window.addEventListener('popstate', handlePopState, true);
  window.__FIELD_ATLAS_NAVIGATION_GUARD__ = {
    clear(id) {
      if (registration?.id === id) registration = null;
    },
    set(nextRegistration) {
      registration = nextRegistration;
    },
  };

  return () => {
    window.removeEventListener('popstate', handlePopState, true);
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
    delete window.__FIELD_ATLAS_NAVIGATION_GUARD__;
  };
}

export const NAVIGATION_GUARD_BOOTSTRAP = `(${installNavigationGuard.toString()})();`;
