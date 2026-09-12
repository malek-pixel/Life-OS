/**
 * React bindings for the store.
 *
 * `useSyncExternalStore` subscribes components to the store's version counter,
 * so any committed write re-renders exactly the components that read data and
 * nothing else. Selectors are memoised on that version, which means derived
 * values (progress rollups, streaks, analytics) are computed once per change
 * rather than once per component.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { store } from '../data/store';
import type { StoreTypes } from '../data/schema';
import { toAppError, type AppError } from '../data/errors';

/** Re-renders on every committed change. The base for every other hook. */
export function useStoreVersion(): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}

/** All non-deleted rows of a collection. */
export function useCollection<K extends keyof StoreTypes>(name: K): StoreTypes[K][] {
  const version = useStoreVersion();
  return useMemo(() => store.live(name), [name, version]);
}

/** A single row by id, or undefined. Soft-deleted rows read as undefined. */
export function useRow<K extends keyof StoreTypes>(
  name: K,
  id: string | undefined,
): StoreTypes[K] | undefined {
  const version = useStoreVersion();
  return useMemo(() => {
    if (!id) return undefined;
    const row = store.byId(name, id);
    if (!row) return undefined;
    return (row as { deletedAt?: number | null }).deletedAt == null ? row : undefined;
  }, [name, id, version]);
}

/**
 * An arbitrary derived value, recomputed when the store changes.
 *
 * `select` is called with no arguments and reads the store directly, so it can
 * join across collections without the caller wiring up each one.
 *
 * `deps` matters whenever the selector closes over component state — a search
 * query, a calendar window, a route param. The selector's own identity is
 * deliberately NOT a dependency (callers pass inline arrows, which would defeat
 * the memo entirely), so anything it reads from outside the store has to be
 * declared here or the value goes stale.
 */
export function useSelector<T>(select: () => T, deps: readonly unknown[] = []): T {
  const version = useStoreVersion();
  const ref = useRef(select);
  ref.current = select;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ref.current(), [version, ...deps]);
}

export function useSettings() {
  useStoreVersion();
  return store.settings;
}

export function useCharacter() {
  useStoreVersion();
  return store.character;
}

export function useStoreStatus() {
  useStoreVersion();
  return { status: store.status, error: store.error };
}

/* ------------------------------------------------------------------ *
 * Async action state
 * ------------------------------------------------------------------ */

/**
 * Wraps an action with pending and error state.
 *
 * Every mutating control in the app goes through this, which is what gives each
 * of them a real loading state and a real failure path rather than only the
 * happy one. Errors are normalised to AppError so the UI always has a code and
 * a message safe to display.
 */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
): {
  run: (...args: Args) => Promise<T | undefined>;
  pending: boolean;
  error: AppError | null;
  reset: () => void;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const alive = useRef(true);
  // Guards against double submits: a second call while one is in flight is
  // dropped rather than queued, so a double-clicked button creates one row.
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        return await action(...args);
      } catch (err) {
        const appError = toAppError(err);
        if (alive.current) setError(appError);
        return undefined;
      } finally {
        inFlight.current = false;
        if (alive.current) setPending(false);
      }
    },
    [action],
  );

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}

/* ------------------------------------------------------------------ *
 * Small UI utilities
 * ------------------------------------------------------------------ */

/** Debounces a value. Used by search and autosave. */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Current viewport width bucket, for the responsive sidebar. */
export function useViewport(): { width: number; compact: boolean; narrow: boolean } {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return { width, compact: width < 1100, narrow: width < 820 };
}

/** Runs `handler` on a keyboard shortcut, ignoring keystrokes inside inputs. */
export function useHotkey(
  combo: { key: string; ctrl?: boolean; shift?: boolean },
  handler: (event: KeyboardEvent) => void,
  options: { allowInInput?: boolean; enabled?: boolean } = {},
): void {
  const { allowInInput = false, enabled = true } = options;
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== combo.key.toLowerCase()) return;
      const wantsModifier = combo.ctrl ?? false;
      const hasModifier = event.ctrlKey || event.metaKey;
      if (wantsModifier !== hasModifier) return;
      if ((combo.shift ?? false) !== event.shiftKey) return;

      if (!allowInInput && isEditable(event.target)) return;
      ref.current(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [combo.key, combo.ctrl, combo.shift, allowInInput, enabled]);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Traps focus inside a container while it is open, and restores focus to
 * whatever was focused before on close. Required for dialogs by ACCESSIBILITY.
 */
export function useFocusTrap(active: boolean): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previous.current = document.activeElement as HTMLElement | null;

    const container = ref.current;
    if (!container) return;

    const focusables = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Focus the first control, so keyboard users land inside the dialog.
    const initial = focusables()[0] ?? container;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previous.current?.focus?.();
    };
  }, [active]);

  return ref;
}

/**
 * Warns before the tab closes while there are unsaved changes.
 *
 * Master prompt section 27 requires this for journal content specifically; it
 * is wired to any editor with a dirty buffer.
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/** Stable id for wiring labels to inputs. */
let idCounter = 0;
export function useFieldId(prefix: string): string {
  const ref = useRef<string>();
  if (!ref.current) ref.current = `${prefix}-${++idCounter}`;
  return ref.current;
}
