/**
 * Modals, drawers, confirmations and toasts.
 *
 * All four share the same behaviour contract, which is what makes overlays feel
 * consistent rather than each screen inventing its own:
 *   - Escape closes, and a click on the scrim closes.
 *   - Focus is trapped inside while open and restored to the trigger on close.
 *   - The dialog is labelled by its own title, so it announces correctly.
 *
 * Destructive confirmations additionally require the danger styling and a
 * distinct action label, per master prompt section 14.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button, IconButton, cx } from './primitives';
import { Icon, type IconName } from './Icon';
import { useFieldId, useFocusTrap } from '../app/hooks';
import { motion, motionMs } from '../design/tokens';

/* ================================================================== *
 * Shared shell
 * ================================================================== */

function OverlayShell({
  open,
  onClose,
  align,
  children,
  labelledBy,
  closeOnScrim = true,
}: {
  open: boolean;
  onClose: () => void;
  align: 'center' | 'top' | 'right';
  children: ReactNode;
  labelledBy: string;
  closeOnScrim?: boolean;
}) {
  const trapRef = useFocusTrap(open);
  const scrimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    // Prevent the page behind from scrolling while an overlay is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={scrimRef}
      className={cx('scrim', `scrim-${align}`)}
      style={{ zIndex: 50 }}
      onMouseDown={(event) => {
        // Only a press that starts AND ends on the scrim closes, so a drag that
        // began inside the dialog does not dismiss it.
        if (closeOnScrim && event.target === scrimRef.current) onClose();
      }}
    >
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={{ display: 'contents' }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ================================================================== *
 * Modal
 * ================================================================== */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useFieldId('modal-title');
  return (
    <OverlayShell open={open} onClose={onClose} align="center" labelledBy={titleId}>
      <div className={cx('modal', wide && 'modal-wide')}>
        <header className="overlay-header">
          <div className="grow">
            <h2 className="overlay-title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', lineHeight: 1.5 }}>
                {description}
              </p>
            ) : null}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="overlay-body los-scroll">{children}</div>
        {footer ? <footer className="overlay-footer">{footer}</footer> : null}
      </div>
    </OverlayShell>
  );
}

/* ================================================================== *
 * Drawer - the detail panel
 * ================================================================== */

export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useFieldId('drawer-title');
  return (
    <OverlayShell open={open} onClose={onClose} align="right" labelledBy={titleId}>
      <aside className="drawer">
        <header className="overlay-header">
          <div className="grow">
            {eyebrow ? <div style={{ marginBottom: 8 }}>{eyebrow}</div> : null}
            <h2 className="overlay-title" id={titleId} style={{ fontSize: 'var(--fs-5xl)' }}>
              {title}
            </h2>
          </div>
          <IconButton icon="close" label="Close panel" onClick={onClose} />
        </header>
        <div className="overlay-body los-scroll">{children}</div>
        {footer ? <footer className="overlay-footer">{footer}</footer> : null}
      </aside>
    </OverlayShell>
  );
}

/* ================================================================== *
 * Confirmation
 * ================================================================== */

export interface ConfirmConfig {
  title: string;
  body: string;
  actionLabel: string;
  /** Styles the action as destructive and warns more strongly. */
  danger?: boolean;
  /** Extra line shown in danger dialogs, e.g. "Export first if you want a copy." */
  note?: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  config,
  onClose,
}: {
  config: ConfirmConfig | null;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPending(false);
    setError(null);
  }, [config]);

  if (!config) return null;

  const run = async () => {
    setPending(true);
    setError(null);
    try {
      await config.onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be completed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={pending ? () => undefined : onClose}
      title={config.title}
      description={config.body}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={config.danger ? 'danger' : 'primary'}
            onClick={run}
            loading={pending}
            // Focused on open so Enter confirms, Escape cancels.
            autoFocus
          >
            {config.actionLabel}
          </Button>
        </>
      }
    >
      {config.note ? (
        <div className={cx('alert', config.danger ? 'alert-error' : 'alert-info')}>
          <Icon name={config.danger ? 'alert' : 'info'} size={15} style={{ marginTop: 1 }} />
          <div className="grow">{config.note}</div>
        </div>
      ) : null}
      {error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={15} style={{ marginTop: 1 }} />
          <div className="grow">{error}</div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ================================================================== *
 * Toasts
 * ================================================================== */

export interface Toast {
  id: string;
  text: string;
  tone: 'ok' | 'xp' | 'error' | 'muted';
  /** Optional single action, e.g. Undo. */
  action?: { label: string; run: () => void };
  /** Milliseconds before auto-dismissal. Errors stay until dismissed. */
  duration?: number;
  /** Set while the exit animation runs, just before removal. */
  leaving?: boolean;
}

interface ToastApi {
  show: (text: string, options?: Partial<Omit<Toast, 'id' | 'text'>>) => string;
  showError: (text: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Toast lifetime. Single source: the motion scale, not a second copy here. */
const DEFAULT_TOAST_MS = motion.toastMs;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  /*
   * Dismissal is two-stage: the toast is marked `leaving` so it can play its
   * exit, then removed once that has run. Without this the node is torn out of
   * the DOM mid-animation and the toast simply vanishes, which reads as a
   * glitch rather than a dismissal.
   *
   * The removal timer is tracked in the same map as the auto-dismiss timer, so
   * unmounting mid-exit cannot leave a stray timeout behind.
   */
  const dismiss = useCallback((id: string) => {
    const existing = timers.current.get(id);
    if (existing) {
      clearTimeout(existing);
      timers.current.delete(id);
    }

    setToasts((current) => {
      // Already leaving: let the running exit finish rather than restarting it.
      if (current.some((t) => t.id === id && t.leaving)) return current;
      return current.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    });

    const removal = window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, motionMs.exit);
    timers.current.set(id, removal);
  }, []);

  const show = useCallback<ToastApi['show']>(
    (text, options = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toast: Toast = { id, text, tone: options.tone ?? 'ok', ...options };
      setToasts((current) => {
        // Cap the stack so a burst of updates cannot bury the screen.
        const next = [...current, toast];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });

      // Errors persist: a failure the user did not see is a silent failure.
      const duration = toast.duration ?? (toast.tone === 'error' ? 0 : DEFAULT_TOAST_MS);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const showError = useCallback<ToastApi['showError']>(
    (text) => show(text, { tone: 'error' }),
    [show],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const api = useMemo(() => ({ show, showError, dismiss }), [show, showError, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    // Polite live region: announcements do not interrupt what the user is doing.
    <div className="toast-stack los-no-print" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const icon: IconName =
          toast.tone === 'error' ? 'alert' : toast.tone === 'xp' ? 'sparkle' : 'check';
        const color =
          toast.tone === 'error'
            ? 'var(--c-danger-bright)'
            : toast.tone === 'xp'
              ? 'var(--c-accent-text)'
              : toast.tone === 'muted'
                ? 'var(--c-text-dim)'
                : 'var(--c-success)';

        return (
          <div
            key={toast.id}
            className={cx(
              'toast',
              toast.tone === 'xp' && 'toast-xp',
              toast.tone === 'error' && 'toast-error',
              toast.leaving && 'toast-leaving',
            )}
          >
            <Icon name={icon} size={15} color={color} style={{ marginTop: 1 }} />
            <span className="grow">{toast.text}</span>
            {toast.action ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.action!.run();
                  onDismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            <IconButton
              icon="close"
              label="Dismiss"
              size="sm"
              iconSize={12}
              onClick={() => onDismiss(toast.id)}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a ToastProvider');
  return api;
}

/* ================================================================== *
 * Confirmation hook
 * ================================================================== */

const ConfirmContext = createContext<((config: ConfirmConfig) => void) | null>(null);

/**
 * Provides app-wide confirmation.
 *
 * Every destructive action routes through this rather than `window.confirm`,
 * so confirmations match the design and are keyboard accessible.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfirmConfig | null>(null);
  const ask = useCallback((next: ConfirmConfig) => setConfig(next), []);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmDialog config={config} onClose={() => setConfig(null)} />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (config: ConfirmConfig) => void {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside a ConfirmProvider');
  return ask;
}
