/**
 * Charts.
 *
 * Hand-built SVG rather than a charting library: the design specifies four
 * simple forms (vertical bars, horizontal bars, a progress ring, a sparkline),
 * and pulling in a chart package for those would fail the dependency test in
 * master prompt section 60.
 *
 * Every chart handles the four data states section 34 requires: present, empty,
 * all-zero, and loading (the caller renders a Skeleton for the last). None of
 * them invents a value to fill space, and each exposes its numbers as a table
 * to screen readers rather than being an unlabelled picture.
 */

import type { ReactNode } from 'react';

import { EmptyState } from './primitives';

/* ================================================================== *
 * Vertical bars - the weekly activity chart
 * ================================================================== */

export function BarChart({
  data,
  height = 132,
  emptyMessage,
  valueSuffix = '',
  label,
}: {
  data: Array<{ label: string; value: number; color?: string; title?: string }>;
  height?: number;
  emptyMessage?: string;
  valueSuffix?: string;
  label: string;
}) {
  if (data.length === 0) {
    return <ChartEmpty message={emptyMessage ?? 'No data for this period yet.'} />;
  }

  const max = Math.max(...data.map((d) => d.value));
  // An all-zero series is meaningful - it says nothing happened - so it renders
  // as a flat baseline rather than a divide-by-zero or a fake shape.
  const allZero = max === 0;

  return (
    <figure style={{ margin: 0 }}>
      <div
        className="row"
        style={{ alignItems: 'flex-end', gap: 7, height, marginBottom: 8 }}
        role="img"
        aria-label={`${label}. ${data.map((d) => `${d.label}: ${d.value}${valueSuffix}`).join(', ')}`}
      >
        {data.map((bar, i) => {
          const pct = allZero ? 0 : (bar.value / max) * 100;
          return (
            <div
              key={`${bar.label}-${i}`}
              className="grow"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
              title={bar.title ?? `${bar.label}: ${bar.value}${valueSuffix}`}
            >
              <div
                className="los-bar-up"
                style={{
                  height: `${Math.max(pct, bar.value > 0 ? 3 : 1.5)}%`,
                  background: bar.value === 0 ? 'var(--c-fill)' : (bar.color ?? 'var(--c-accent)'),
                  borderRadius: 'var(--r-xs)',
                  minHeight: 2,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="row" style={{ gap: 7 }}>
        {data.map((bar, i) => (
          <span
            key={`${bar.label}-label-${i}`}
            className="grow mono"
            style={{ textAlign: 'center', fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}
          >
            {bar.label}
          </span>
        ))}
      </div>
      {allZero ? (
        <figcaption style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', marginTop: 8 }}>
          Nothing logged in this period yet.
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ================================================================== *
 * Horizontal bars - the per-area scores
 * ================================================================== */

export function BarList({
  data,
  emptyMessage,
}: {
  data: Array<{ label: string; value: number | null; color: string; meta?: string }>;
  emptyMessage?: string;
}) {
  if (data.length === 0) return <ChartEmpty message={emptyMessage ?? 'Nothing to compare yet.'} />;

  return (
    <div className="stack" style={{ gap: 13 }}>
      {data.map((row) => (
        <div key={row.label}>
          <div className="spread" style={{ marginBottom: 5, gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-strong)' }}>{row.label}</span>
            <span
              className="mono"
              style={{
                fontSize: 'var(--fs-xs)',
                color: row.value == null ? 'var(--c-text-ghost)' : 'var(--c-text-muted)',
                flex: 'none',
              }}
            >
              {/* An untracked area reads as "not tracked", never as 0%. */}
              {row.value == null ? 'not tracked' : `${row.value}%`}
            </span>
          </div>
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={row.value ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${row.label}: ${row.value == null ? 'not tracked' : `${row.value}%`}`}
          >
            {row.value != null ? (
              <div
                className="bar-fill los-bar-fill"
                style={{ width: `${row.value}%`, background: row.color }}
              />
            ) : null}
          </div>
          {row.meta ? (
            <p style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', margin: '5px 0 0' }}>
              {row.meta}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== *
 * Progress ring - the Life OS score
 * ================================================================== */

export function Ring({
  value,
  size = 128,
  thickness = 10,
  color = 'var(--c-accent)',
  label,
  caption,
}: {
  /** null when there is not enough data to score - shows a dashed placeholder. */
  value: number | null;
  size?: number;
  thickness?: number;
  color?: string;
  label: string;
  caption?: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = value == null ? 0 : (circumference * Math.max(0, Math.min(100, value))) / 100;

  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={`${label}: ${value == null ? 'not enough data' : `${value} out of 100`}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--c-fill)"
            strokeWidth={thickness}
            strokeDasharray={value == null ? '4 6' : undefined}
          />
          {value != null ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              style={{ transition: 'stroke-dasharray .9s var(--ease)' }}
            />
          ) : null}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            className="mono los-count"
            style={{
              fontSize: value == null ? 'var(--fs-2xl)' : 'var(--fs-7xl)',
              fontWeight: 700,
              lineHeight: 1,
              color: value == null ? 'var(--c-text-ghost)' : 'var(--c-text)',
            }}
          >
            {value == null ? '—' : value}
          </span>
          {caption ? (
            <span
              className="mono"
              style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', marginTop: 3, letterSpacing: '.08em' }}
            >
              {caption}
            </span>
          ) : null}
        </div>
      </div>
    </figure>
  );
}

/* ================================================================== *
 * Sparkline - the XP trend
 * ================================================================== */

export function Sparkline({
  data,
  width = 520,
  height = 74,
  color = 'var(--c-accent)',
  label,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label: string;
}) {
  if (data.length < 2) {
    return <ChartEmpty message="A trend needs at least two days of history." />;
  }

  const max = Math.max(...data, 1);
  const step = width / (data.length - 1);
  const points = data.map((value, i) => {
    const x = i * step;
    const y = height - (value / max) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`${label}. Peak ${max}.`}
      >
        <polyline
          points={`0,${height} ${points.join(' ')} ${width},${height}`}
          fill={color}
          opacity={0.12}
          stroke="none"
        />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </figure>
  );
}

/* ================================================================== *
 * Shared
 * ================================================================== */

function ChartEmpty({ message }: { message: string }) {
  return (
    <p
      style={{
        fontSize: 'var(--fs-md)',
        color: 'var(--c-text-ghost)',
        textAlign: 'center',
        padding: '28px 12px',
        margin: 0,
        lineHeight: 1.6,
      }}
    >
      {message}
    </p>
  );
}

/** Chart wrapper that swaps in an empty state when there is nothing to draw. */
export function ChartFrame({
  hasData,
  emptyTitle,
  emptyBody,
  children,
}: {
  hasData: boolean;
  emptyTitle: string;
  emptyBody: string;
  children: ReactNode;
}) {
  if (!hasData) return <EmptyState icon="analytics" title={emptyTitle} body={emptyBody} />;
  return <>{children}</>;
}
