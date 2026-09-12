/**
 * The persistent sidebar.
 *
 * UI/UX section 07 specifies exactly one navigation system - a desktop sidebar
 * with a LIFE divider partway down, an identity block with live XP, and a
 * collapsed icon-only mode. That structure is reproduced here, driven by real
 * character state rather than the design's sample numbers.
 *
 * Responsive behaviour beyond the desktop case is a deliberate addition: the
 * spec designs for Windows window-resizing only, but a browser window genuinely
 * can be narrow, so below 820px the sidebar becomes an overlay drawer rather
 * than squeezing the content to nothing.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon, type IconName } from '../ui/Icon';
import { IconButton, ProgressBar, cx } from '../ui/primitives';
import { useCharacter, useSettings } from './hooks';
import { levelForXp } from '../domain/xp';
import { layout } from '../design/tokens';

interface NavEntry {
  label: string;
  to: string;
  icon: IconName;
}

/** Order taken verbatim from the design's navDefs. */
const PRIMARY: NavEntry[] = [
  { label: 'Dashboard', to: '/dashboard', icon: 'dashboard' },
  { label: 'Goals', to: '/goals', icon: 'goals' },
  { label: 'Projects', to: '/projects', icon: 'projects' },
  { label: 'Tasks', to: '/tasks', icon: 'tasks' },
  { label: 'Habits', to: '/habits', icon: 'habits' },
  { label: 'Routines', to: '/routines', icon: 'routines' },
  { label: 'Calendar', to: '/calendar', icon: 'calendar' },
  { label: 'Fitness', to: '/fitness', icon: 'fitness' },
  { label: 'Journal', to: '/journal', icon: 'journal' },
  { label: 'Notes', to: '/notes', icon: 'notes' },
  { label: 'Analytics', to: '/analytics', icon: 'analytics' },
  { label: 'AI', to: '/ai', icon: 'ai' },
];

const LIFE: NavEntry[] = [
  { label: 'Life Map', to: '/life-map', icon: 'lifemap' },
  { label: 'Quests', to: '/quests', icon: 'quests' },
  { label: 'Achievements', to: '/achievements', icon: 'achievements' },
  { label: 'Reviews', to: '/reviews', icon: 'reviews' },
  { label: 'Timeline', to: '/timeline', icon: 'timeline' },
];

export function Sidebar({
  collapsed,
  onToggle,
  overlay,
  onNavigate,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** True when the sidebar is floating over the content on a narrow window. */
  overlay?: boolean;
  onNavigate?: () => void;
}) {
  const settings = useSettings();
  const character = useCharacter();
  const location = useLocation();
  const progression = levelForXp(character.totalXp);

  /*
   * On a narrow window, following a link should close the overlay.
   *
   * The first run is skipped deliberately. As an overlay this component is
   * mounted *by* the drawer opening, so an effect that fires on mount called
   * onNavigate immediately and closed the drawer on the same tick it opened -
   * the hamburger appeared to do nothing at all. Only a genuine change of route
   * should dismiss it.
   */
  const mountedPath = useRef(location.pathname);
  useEffect(() => {
    if (mountedPath.current === location.pathname) return;
    mountedPath.current = location.pathname;
    if (overlay) onNavigate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const width = collapsed ? layout.sidebarCollapsedWidth : layout.sidebarWidth;
  const initial = (settings.displayName || 'L').trim().charAt(0).toUpperCase();

  return (
    <nav
      aria-label="Main"
      className={cx('los-sidebar', overlay && 'los-sidebar-overlay')}
      style={{
        width,
        flex: 'none',
        background: 'var(--c-bg-panel)',
        borderRight: '1px solid var(--c-border-faint)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        ...(overlay
          ? { position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 40, boxShadow: 'var(--sh-overlay)' }
          : null),
      }}
    >
      {/* ---------- identity + XP ---------- */}
      <div style={{ padding: '16px 14px', borderBottom: '1px solid var(--c-border-faint)' }}>
        <div
          className="row"
          style={{ gap: 11, justifyContent: collapsed ? 'center' : undefined }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              flex: 'none',
              borderRadius: 9,
              background: 'linear-gradient(150deg,#241a20,#16121a)',
              border: '1px solid rgba(255,255,255,.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              color: 'var(--c-accent-text)',
              fontSize: 16,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {initial}
          </div>

          {!collapsed ? (
            <>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, lineHeight: 1.2 }}>
                  {settings.displayName || 'Life OS'}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 'var(--fs-xs)',
                    marginTop: 2,
                    letterSpacing: '.02em',
                    color: settings.showRankBadges ? 'var(--c-accent-text)' : 'var(--c-text-faint)',
                  }}
                >
                  {/* Honest by default: no rank title until XP exists to earn one. */}
                  {settings.showRankBadges
                    ? character.totalXp > 0
                      ? progression.rank.title
                      : 'no rank yet'
                    : 'rank hidden'}
                </div>
              </div>
              <IconButton icon="collapse" label="Collapse sidebar" size="sm" onClick={onToggle} />
            </>
          ) : null}
        </div>

        {!collapsed ? (
          <div style={{ marginTop: 14 }}>
            <div
              className="mono spread"
              style={{ alignItems: 'baseline', marginBottom: 6, gap: 6 }}
            >
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}>
                LVL <span style={{ color: 'var(--c-text)', fontWeight: 700 }}>{progression.level}</span>
              </span>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--c-text-dim)' }}>
                {progression.xpIntoLevel} / {progression.xpForLevel}
                <span style={{ color: 'var(--c-accent-text)' }}> XP</span>
              </span>
            </div>
            <ProgressBar
              percent={progression.percent}
              label={`Level ${progression.level}, ${progression.percent}% to the next level`}
              color="linear-gradient(90deg,var(--c-accent-deep),var(--c-accent))"
              scan
            />
          </div>
        ) : null}

        {collapsed ? (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <IconButton icon="expand" label="Expand sidebar" size="sm" onClick={onToggle} />
          </div>
        ) : null}
      </div>

      {/* ---------- links ---------- */}
      <div className="los-scroll grow" style={{ padding: collapsed ? '10px 0' : '10px 8px' }}>
        {PRIMARY.map((entry) => (
          <SidebarLink key={entry.to} entry={entry} collapsed={collapsed} />
        ))}

        <Divider label="LIFE" collapsed={collapsed} />

        {LIFE.map((entry) => (
          <SidebarLink key={entry.to} entry={entry} collapsed={collapsed} />
        ))}
      </div>

      {/* ---------- settings, pinned to the bottom ---------- */}
      <div
        style={{
          padding: collapsed ? '8px 0 12px' : '8px 8px 12px',
          borderTop: '1px solid var(--c-border-faint)',
        }}
      >
        <SidebarLink
          entry={{ label: 'Settings', to: '/settings', icon: 'settings' }}
          collapsed={collapsed}
        />
      </div>
    </nav>
  );
}

function Divider({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div
        aria-hidden="true"
        style={{
          height: 1,
          background: 'var(--c-border-faint)',
          margin: '10px auto',
          width: 24,
        }}
      />
    );
  }
  return (
    <div
      className="mono"
      style={{
        fontSize: 'var(--fs-3xs)',
        letterSpacing: '.08em',
        color: 'var(--c-text-ghost)',
        padding: '16px 10px 7px',
      }}
    >
      {label}
    </div>
  );
}

function SidebarLink({ entry, collapsed }: { entry: NavEntry; collapsed: boolean }) {
  /*
   * Tooltip for the collapsed rail, replacing the native `title` - which cannot
   * be styled and waits about a second before appearing.
   *
   * Positioned fixed, and measured on hover, because the rail scrolls: an
   * absolutely-positioned tooltip is clipped by the `overflow: auto` on the
   * link list, so a CSS-only version is invisible for exactly the items that
   * need it. Fixed coordinates escape the scroll container.
   *
   * This is the visible affordance only. The accessible name comes from the
   * screen-reader label below, because hover text names nothing.
   */
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const showTip = (event: { currentTarget: HTMLElement }) => {
    if (!collapsed) return;
    const r = event.currentTarget.getBoundingClientRect();
    // Clamped to the viewport so an item at the very bottom stays readable.
    setTip({ top: Math.min(r.top + r.height / 2, window.innerHeight - 24), left: r.right + 10 });
  };

  return (
    <NavLink
      to={entry.to}
      className="los-press los-nav"
      onMouseEnter={showTip}
      onFocus={showTip}
      onMouseLeave={() => setTip(null)}
      onBlur={() => setTip(null)}
      style={({ isActive }) =>
        collapsed
          ? {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              margin: '0 auto 3px',
              borderRadius: 8,
              background: isActive ? 'var(--c-accent-wash-strong)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--c-accent-border-strong)' : 'transparent'}`,
              color: isActive ? 'var(--c-accent-text)' : 'var(--c-text-dim)',
            }
          : {
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              padding: '8px 10px',
              borderRadius: 7,
              marginBottom: 1,
              borderLeft: `2px solid ${isActive ? 'var(--c-accent)' : 'transparent'}`,
              background: isActive ? 'var(--c-accent-wash)' : 'transparent',
              color: isActive ? 'var(--c-text)' : 'var(--c-text-muted)',
              fontWeight: isActive ? 600 : 500,
              fontSize: 'var(--fs-md)',
            }
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            name={entry.icon}
            size={17}
            color={isActive ? 'var(--c-accent-text)' : 'var(--c-text-dim)'}
          />
          {/*
            * Collapsed, the label is still rendered - just only for screen
            * readers. The visible affordance is the styled tooltip, but a
            * tooltip is a hover effect and carries no accessible name, so
            * without this the icon rail would be eighteen unnamed links.
            */}
          {collapsed ? (
            <>
              <span className="los-sr">{entry.label}</span>
              {tip
                ? createPortal(
                    // aria-hidden: the link is already named by the label above,
                    // so announcing this too would just repeat it.
                    <span className="los-tip-bubble" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>
                      {entry.label}
                    </span>,
                    document.body,
                  )
                : null}
            </>
          ) : (
            <span className="truncate">{entry.label}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

/** Exported for the command palette, so navigation targets stay in one list. */
export const NAV_ENTRIES = [...PRIMARY, ...LIFE, { label: 'Settings', to: '/settings', icon: 'settings' as IconName }];
