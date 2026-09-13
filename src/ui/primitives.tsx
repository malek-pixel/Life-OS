/**
 * The component library.
 *
 * One implementation per visual pattern, per master prompt section 13. Screens
 * compose these; no screen re-implements a button, a card or an empty state.
 *
 * Two rules hold throughout:
 *  - Every interactive element supports the full state set from section 15:
 *    hover, active, focus, disabled, and where relevant loading.
 *  - Every icon-only control takes a required `label`, so it has an accessible
 *    name (section 45). The type system enforces it rather than a review.
 */

import {
  forwardRef,

  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Icon, type IconName } from './Icon';
import { formatStatValue, parseStatValue } from './statValue';
import { motion } from '../design/tokens';
import { useAnimatedValue, useCountUp, useFieldId } from '../app/hooks';

/* ================================================================== *
 * Button
 * ================================================================== */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Shows a spinner and blocks input while an action is in flight. */
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, block, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        'btn los-press',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        block && 'btn-block',
        className,
      )}
      disabled={disabled || loading}
      // Announces the busy state to screen readers, not just visually.
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn-spinner" /> : icon ? <Icon name={icon} size={15} /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: this is the control's only accessible name. */
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  iconSize?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, iconSize, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('icon-btn los-press', size === 'sm' && 'icon-btn-sm', active && 'icon-btn-active', className)}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 14 : 16)} />
    </button>
  );
});

/* ================================================================== *
 * Surfaces
 * ================================================================== */

export function Card({
  children,
  flush,
  hoverable,
  className,
  style,
  as: Tag = 'section',
}: {
  children: ReactNode;
  flush?: boolean;
  hoverable?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Tag
      className={cx('card', flush && 'card-flush', hoverable && 'los-card-hover', className)}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  kicker,
  action,
}: {
  title: ReactNode;
  kicker?: string;
  action?: ReactNode;
}) {
  return (
    <header className="card-header">
      <div className="grow">
        {kicker ? <p className="card-kicker">{kicker}</p> : null}
        <h2 className="card-title">{title}</h2>
      </div>
      {action}
    </header>
  );
}

/* ================================================================== *
 * Form fields
 * ================================================================== */

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (id: string, describedBy: string | undefined, invalid: boolean) => ReactNode;
}

/**
 * Shared label/hint/error wiring.
 *
 * The control is linked to its label, its hint and its error via ids, and gets
 * `aria-invalid` when it fails, so a screen reader announces the problem rather
 * than the user discovering it visually.
 */
function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const id = useFieldId('field');
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children(id, describedBy, !!error)}
      {error ? (
        <p className="field-error" id={errorId} role="alert">
          <Icon name="alert" size={12} />
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, required, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {(id, describedBy, invalid) => (
        <input
          id={id}
          className={cx('input', invalid && 'input-invalid')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextAreaField({ label, hint, error, required, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {(id, describedBy, invalid) => (
        <textarea
          id={id}
          className={cx('textarea', invalid && 'textarea-invalid')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function SelectField({ label, hint, error, options, required, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {(id, describedBy, invalid) => (
        <select
          id={id}
          className={cx('select', invalid && 'select-invalid')}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

/* ================================================================== *
 * Toggles
 * ================================================================== */

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: () => void;
  /** Describes what is being toggled, e.g. the task title. */
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onChange}
      className={cx('checkbox', checked && 'checkbox-on')}
    >
      {checked ? <Icon name="check" size={12} strokeWidth={3} /> : null}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cx('toggle', checked && 'toggle-on')}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/**
 * Segmented control.
 *
 * Uses the tablist pattern with arrow-key navigation, which is what keyboard
 * users expect from a segmented control.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  const listRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);

  /*
   * Measure the selected tab and park the indicator over it.
   *
   * Layout-effect rather than effect so the indicator is already in place on
   * first paint — measuring after paint would show it at x=0 for a frame and
   * then slide, which reads as a glitch rather than a transition.
   *
   * Re-measures when the option set or the label text changes (both change the
   * geometry) and on container resize, so the pill cannot drift away from the
   * tab it is meant to be marking.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return;
      setIndicator({ x: active.offsetLeft, w: active.offsetWidth });
    };
    measure();

    // Web fonts arriving change every label's width after the first measure.
    void document.fonts?.ready.then(measure);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    // Each tab, not just the bar: on a phone the tabs stretch to fill the row,
    // so a tab can move without the bar's own size changing - which left the
    // pill sitting between two tabs.
    observer.observe(list);
    list.querySelectorAll('[role="tab"]').forEach((tab) => observer.observe(tab));
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div className="tabs" role="tablist" aria-label={label} ref={listRef}>
      <span
        className="tab-indicator"
        data-ready={indicator ? 'true' : 'false'}
        aria-hidden="true"
        style={
          indicator
            ? { transform: `translateX(${indicator.x}px) scaleX(${indicator.w})` }
            : undefined
        }
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className={cx('tab los-press', option.value === value && 'tab-on')}
          onClick={() => onChange(option.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== *
 * Badges
 * ================================================================== */

export function Badge({
  children,
  color = 'var(--c-text-muted)',
  border,
  background,
}: {
  children: ReactNode;
  color?: string;
  border?: string;
  background?: string;
}) {
  return (
    <span
      className="badge"
      style={{
        color,
        borderColor: border ?? 'var(--c-border-faint)',
        background: background ?? 'transparent',
      }}
    >
      {children}
    </span>
  );
}

/** Priority as a coloured stripe, matching the design's task rows. */
export function PriorityDot({ priority }: { priority: 'LOW' | 'MEDIUM' | 'HIGH' }) {
  const color =
    priority === 'HIGH'
      ? 'var(--c-danger)'
      : priority === 'MEDIUM'
        ? 'var(--c-warn)'
        : 'var(--c-border-input)';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 3,
        alignSelf: 'stretch',
        minHeight: 22,
        borderRadius: 2,
        background: color,
        flex: 'none',
      }}
    />
  );
}

/* ================================================================== *
 * Progress
 * ================================================================== */

export function ProgressBar({
  percent,
  color = 'var(--c-accent)',
  large,
  animate = true,
  label,
  scan,
}: {
  percent: number;
  color?: string;
  large?: boolean;
  animate?: boolean;
  /** Describes what is progressing; required for the progressbar role. */
  label: string;
  scan?: boolean;
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));

  /*
   * The fill is full-width and scaled, rather than sized by a width percentage.
   *
   * Two reasons. Transform is composited, so the bar cannot cause a reflow on
   * any frame. And because one property expresses the value, the *same*
   * transition covers both the entrance (0 to the current value on mount) and
   * every later change (old value to new), which is what section 20 asks for:
   * progress that visibly advances instead of teleporting.
   *
   * Starting at 0 and setting the real value in an effect is what gives the
   * mount case something to animate from. `animate={false}` skips that, for
   * places that render many bars at once and should simply show their value.
   */
  const shown = useAnimatedValue(value, animate);

  return (
    <div
      className={cx('bar', large && 'bar-lg')}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="bar-fill"
        style={{ transform: `scaleX(${shown / 100})`, background: color }}
      />
      {scan && value > 0 ? <span className="bar-scan" /> : null}
    </div>
  );
}

/* ================================================================== *
 * Loading, empty and error states
 * ================================================================== */

/**
 * Skeleton block.
 *
 * Skeletons mirror the geometry of the content they replace (section 16), so
 * the layout does not shift when real data arrives.
 */
export function Skeleton({
  width = '100%',
  height = 12,
  radius,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="los-skel"
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

/**
 * The screen-transition skeleton from the approved design's SKELETON LOADING
 * artboard: a title bar, a four-up stat grid, then the 1.55fr/1fr split with a
 * tall left block and two stacked right blocks.
 *
 * Geometry mirrors the real layout (section 16), so swapping it for content
 * does not shift anything.
 */
export function ScreenSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="los-sr">Loading…</span>
      <Skeleton width={180} height={26} style={{ marginBottom: 22 }} />
      <div className="grid-stats" style={{ marginBottom: 22 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={84} radius={11} />
        ))}
      </div>
      <div className="grid-2">
        <Skeleton height={300} radius={11} />
        <div className="stack" style={{ gap: 16 }}>
          <Skeleton height={120} radius={11} />
          <Skeleton height={160} radius={11} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid-cards" aria-busy="true">
      <span className="los-sr">Loading…</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="card" key={i}>
          <Skeleton width="58%" height={13} />
          <Skeleton width="34%" height={10} style={{ marginTop: 9 }} />
          <Skeleton width="100%" height={6} radius={4} style={{ marginTop: 18 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state.
 *
 * Section 17 requires each one to say what is missing, why it matters, and what
 * to do next - so `title`, `body` and an action are all part of the contract
 * rather than optional decoration.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={21} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-body">{body}</p>
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );
}

/**
 * Error state for a failed load or action.
 *
 * Always says what failed and whether the user's data survived, and offers a
 * retry when the error is retryable - section 18.
 */
export function ErrorState({
  title = 'That did not work',
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="empty-state" role="alert">
      <div
        className="empty-state-icon"
        style={{ borderColor: 'rgba(194,58,84,.35)', color: 'var(--c-danger-bright)' }}
      >
        <Icon name="alert" size={21} />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-body">{message}</p>
      {onRetry ? (
        <Button variant="secondary" icon="refresh" onClick={onRetry} style={{ marginTop: 6 }}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/* ================================================================== *
 * Misc
 * ================================================================== */

/** Page heading with an optional action cluster. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="spread page-header" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
      <div className="grow">
        <h1 style={{ fontSize: 'var(--fs-5xl)', fontWeight: 600, margin: 0, lineHeight: 1.2 }}>
          {title}
        </h1>
        {subtitle ? (
          <p style={{ margin: '5px 0 0', fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="row" style={{ gap: 8 }}>{actions}</div> : null}
    </header>
  );
}

/**
 * Animates the numeric part of a formatted statistic.
 *
 * Takes the already-formatted string the screens pass today ("1,240", "86%",
 * "3d", "--") rather than a number, so every existing call site keeps working
 * and no screen has to hand over its formatting. The leading number is rolled
 * up and the prefix and suffix are held fixed; anything with no number in it,
 * such as an em dash placeholder, renders unchanged and never animates.
 *
 * Thousands separators are re-applied only if the source had them, so "2024"
 * does not become "2,024".
 */
function CountUp({ value }: { value: string }) {
  const parts = parseStatValue(value);
  const shown = useCountUp(parts.target, motion.countUpMs);

  // No number in it - an em dash placeholder, say. Render it untouched.
  if (!Number.isFinite(parts.target)) return <>{value}</>;

  return <>{formatStatValue(parts, shown)}</>;
}

/** Small stat tile, as used on the dashboard and fitness headers. */
export function StatTile({
  label,
  value,
  delta,
  tone = 'muted',
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: 'accent' | 'muted';
}) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <p className="card-kicker" style={{ marginBottom: 8 }}>
        {label}
      </p>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        {/*
          * Monospace and tabular figures: a proportional font changes width as
          * the digits roll, which would make the tile jitter for the whole
          * animation and shift anything beside it.
          */}
        <span
          className="los-count"
          style={{
            fontSize: 'var(--fs-6xl)',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          <CountUp value={value} />
        </span>
        {delta ? (
          <span
            style={{
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
              color: tone === 'accent' ? 'var(--c-accent-text)' : 'var(--c-text-faint)',
            }}
          >
            {delta}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Joins class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
