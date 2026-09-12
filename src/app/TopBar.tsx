/**
 * The top bar: breadcrumb, global search, quick capture.
 *
 * Search here is a launcher rather than a results panel - typing opens the
 * command palette, which is the single search surface (UI/UX section 31-32).
 * Having two different search experiences would be exactly the inconsistency
 * the design system exists to prevent.
 */

import { Link, useLocation } from 'react-router-dom';

import { Icon } from '../ui/Icon';
import { Button, IconButton } from '../ui/primitives';
import { NAV_ENTRIES } from './Sidebar';
import { greeting } from '../domain/dates';

export function TopBar({
  onOpenPalette,
  onOpenCapture,
  onOpenNav,
}: {
  onOpenPalette: () => void;
  onOpenCapture: () => void;
  /** Present only on narrow windows, where the sidebar is an overlay. */
  onOpenNav?: () => void;
}) {
  const location = useLocation();
  const crumbs = breadcrumbFor(location.pathname);

  return (
    <header
      className="spread los-no-print"
      style={{
        height: 56,
        flex: 'none',
        padding: '0 20px',
        borderBottom: '1px solid var(--c-border-faint)',
        background: 'var(--c-bg-app)',
        gap: 14,
      }}
    >
      <div className="row grow" style={{ gap: 12, minWidth: 0 }}>
        {onOpenNav ? (
          <IconButton icon="dashboard" label="Open navigation" onClick={onOpenNav} />
        ) : null}

        <nav aria-label="Breadcrumb" className="row truncate" style={{ gap: 7, minWidth: 0 }}>
          {crumbs.map((crumb, i) => (
            <span key={crumb.to ?? crumb.label} className="row truncate" style={{ gap: 7 }}>
              {i > 0 ? (
                <Icon name="chevronRight" size={13} color="var(--c-text-ghost)" />
              ) : null}
              {crumb.to && i < crumbs.length - 1 ? (
                <Link
                  to={crumb.to}
                  className="truncate"
                  style={{ color: 'var(--c-text-dim)', fontSize: 'var(--fs-md)' }}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className="truncate"
                  style={{
                    color: i === crumbs.length - 1 ? 'var(--c-text)' : 'var(--c-text-dim)',
                    fontSize: 'var(--fs-md)',
                    fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  }}
                  aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className="row" style={{ gap: 9, flex: 'none' }}>
        {/*
          A button rather than an input: it opens the palette, and a text field
          that does not accept text where it appears would be misleading.
        */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="los-press"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            height: 32,
            padding: '0 11px',
            borderRadius: 'var(--r-lg)',
            border: '1px solid var(--c-border-faint)',
            background: 'var(--c-bg-root)',
            color: 'var(--c-text-dim)',
            fontSize: 'var(--fs-md)',
            cursor: 'pointer',
            minWidth: 190,
          }}
        >
          <Icon name="search" size={14} />
          <span className="grow" style={{ textAlign: 'left' }}>
            Search or run a command
          </span>
          <kbd
            className="mono"
            style={{
              fontSize: 'var(--fs-3xs)',
              color: 'var(--c-text-ghost)',
              border: '1px solid var(--c-border-faint)',
              borderRadius: 4,
              padding: '2px 5px',
            }}
          >
            Ctrl K
          </kbd>
        </button>

        <Button variant="primary" icon="plus" size="sm" onClick={onOpenCapture}>
          Capture
        </Button>
      </div>
    </header>
  );
}

interface Crumb {
  label: string;
  to?: string;
}

/**
 * Breadcrumb for a path.
 *
 * Detail routes get a two-level trail (Goals > this goal) per UI/UX section 07;
 * the entity name itself is filled in by the detail screen's own heading, so
 * this stays a cheap pure function rather than a store read.
 */
function breadcrumbFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [{ label: 'Dashboard' }];

  const root = `/${segments[0]}`;
  const entry = NAV_ENTRIES.find((e) => e.to === root);
  const label = entry?.label ?? title(segments[0]!);

  if (segments.length === 1) return [{ label }];
  return [
    { label, to: root },
    { label: title(segments[1]!) },
  ];
}

function title(segment: string): string {
  if (/^[0-9a-f-]{16,}$/i.test(segment)) return 'Detail';
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
}

export { greeting };
