/**
 * The icon set.
 *
 * Paths are taken verbatim from the approved design's ICONS map, drawn on a
 * 24x24 grid with a 1.7 stroke. Every icon inherits `currentColor`, so colour
 * is decided by the surrounding component rather than baked in here.
 *
 * Icons are decorative by default (`aria-hidden`), because they nearly always
 * sit beside a visible label. An icon carrying meaning on its own takes a
 * `title`, which turns it into an accessible image - see IconButton, which
 * requires a label for exactly this reason.
 */

import type { CSSProperties } from 'react';

export type IconName =
  | 'dashboard'
  | 'goals'
  | 'projects'
  | 'tasks'
  | 'habits'
  | 'calendar'
  | 'fitness'
  | 'journal'
  | 'notes'
  | 'analytics'
  | 'ai'
  | 'lifemap'
  | 'quests'
  | 'achievements'
  | 'reviews'
  | 'routines'
  | 'timeline'
  | 'settings'
  | 'search'
  | 'plus'
  | 'collapse'
  | 'expand'
  | 'close'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'trash'
  | 'edit'
  | 'menu'
  | 'more'
  | 'pin'
  | 'archive'
  | 'undo'
  | 'alert'
  | 'info'
  | 'clock'
  | 'flag'
  | 'link'
  | 'download'
  | 'upload'
  | 'refresh'
  | 'send'
  | 'stop'
  | 'shield'
  | 'sparkle'
  | 'filter'
  | 'inbox';

type Path = [string, Record<string, unknown>];

const PATHS: Record<IconName, Path[]> = {
  /* --- navigation, from the design --- */
  dashboard: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
  ],
  goals: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['circle', { cx: 12, cy: 12, r: 5 }],
    ['circle', { cx: 12, cy: 12, r: 1.6 }],
  ],
  projects: [
    ['path', { d: 'M12 2 2 7l10 5 10-5-10-5Z' }],
    ['path', { d: 'm2 17 10 5 10-5' }],
    ['path', { d: 'm2 12 10 5 10-5' }],
  ],
  tasks: [
    ['path', { d: 'm3 7 2 2 4-4' }],
    ['path', { d: 'M13 6h8' }],
    ['path', { d: 'm3 17 2 2 4-4' }],
    ['path', { d: 'M13 16h8' }],
  ],
  habits: [
    ['path', { d: 'm17 2 4 4-4 4' }],
    ['path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }],
    ['path', { d: 'm7 22-4-4 4-4' }],
    ['path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }],
  ],
  calendar: [
    ['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ['path', { d: 'M16 2v4M8 2v4M3 10h18' }],
  ],
  fitness: [['path', { d: 'M22 12h-4l-3 9L9 3l-3 9H2' }]],
  journal: [
    ['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }],
    ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }],
  ],
  notes: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z' }],
    ['path', { d: 'M14 2v5h5' }],
    ['path', { d: 'M10 12H8M16 16H8' }],
  ],
  analytics: [
    ['path', { d: 'M3 3v18h18' }],
    ['path', { d: 'M7 16v-4M12 16V9M17 16v-6' }],
  ],
  ai: [
    ['path', { d: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z' }],
    ['path', { d: 'M18 14l.7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7z' }],
  ],
  lifemap: [
    ['circle', { cx: 6, cy: 6, r: 2.4 }],
    ['circle', { cx: 18, cy: 8, r: 2.4 }],
    ['circle', { cx: 9, cy: 18, r: 2.4 }],
    ['path', { d: 'M8 7.2 15.8 7.6M7.4 8.1 8.4 15.6M11 17l5.2-7' }],
  ],
  quests: [['path', { d: 'M12 2l2.4 5 5.5.5-4.2 3.6 1.3 5.4L12 19l-5 2.5 1.3-5.4L4 12.5 9.6 12z' }]],
  achievements: [
    ['circle', { cx: 12, cy: 9, r: 5.5 }],
    ['path', { d: 'M8.5 13.5 7 22l5-3 5 3-1.5-8.5' }],
  ],
  reviews: [
    ['path', { d: 'M9 11l3 3L22 4' }],
    ['path', { d: 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' }],
  ],
  routines: [
    ['path', { d: 'M12 2v4M12 18v4M2 12h4M18 12h4' }],
    ['circle', { cx: 12, cy: 12, r: 5 }],
  ],
  timeline: [
    ['path', { d: 'M12 3v18' }],
    ['circle', { cx: 12, cy: 7, r: 2 }],
    ['circle', { cx: 12, cy: 17, r: 2 }],
    ['path', { d: 'M14 7h6M4 17h6' }],
  ],
  settings: [['path', { d: 'M4 21v-6M4 11V3M12 21v-9M12 7V3M20 21v-4M20 13V3M1 15h6M9 7h6M17 17h6' }]],

  /* --- controls --- */
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  collapse: [['path', { d: 'm11 17-5-5 5-5' }], ['path', { d: 'm18 17-5-5 5-5' }]],
  expand: [['path', { d: 'm13 17 5-5-5-5' }], ['path', { d: 'm6 17 5-5-5-5' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
  chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  trash: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M10 11v6M14 11v6' }],
  ],
  edit: [
    ['path', { d: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' }],
  ],
  menu: [
    ['path', { d: 'M4 7h16' }],
    ['path', { d: 'M4 12h16' }],
    ['path', { d: 'M4 17h16' }],
  ],
  more: [
    ['circle', { cx: 12, cy: 5, r: 1 }],
    ['circle', { cx: 12, cy: 12, r: 1 }],
    ['circle', { cx: 12, cy: 19, r: 1 }],
  ],
  pin: [['path', { d: 'M12 17v5M9 3h6l-1 7 3 3H7l3-3z' }]],
  archive: [
    ['rect', { x: 3, y: 3, width: 18, height: 5, rx: 1 }],
    ['path', { d: 'M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8' }],
    ['path', { d: 'M10 12h4' }],
  ],
  undo: [['path', { d: 'M3 7v6h6' }], ['path', { d: 'M3 13a9 9 0 1 0 3-7.7L3 8' }]],
  alert: [
    ['path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }],
    ['path', { d: 'M12 9v4M12 17h.01' }],
  ],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 16v-4M12 8h.01' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  flag: [['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z' }], ['path', { d: 'M4 22v-7' }]],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' }],
  ],
  download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7 10 5 5 5-5M12 15V3' }]],
  upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm17 8-5-5-5 5M12 3v12' }]],
  refresh: [['path', { d: 'M21 12a9 9 0 1 1-3-6.7L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
  send: [['path', { d: 'M22 2 11 13' }], ['path', { d: 'M22 2 15 22l-4-9-9-4z' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 2 }]],
  shield: [['path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }]],
  sparkle: [['path', { d: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z' }]],
  filter: [['path', { d: 'M22 3H2l8 9.5V19l4 2v-8.5z' }]],
  inbox: [
    ['path', { d: 'M22 12h-6l-2 3h-4l-2-3H2' }],
    ['path', { d: 'M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z' }],
  ],
};

export interface IconProps {
  name: IconName;
  size?: number;
  /** Stroke width. The design uses 1.7 for navigation and 1.8 for chrome. */
  strokeWidth?: number;
  color?: string;
  style?: CSSProperties;
  /** Provide when the icon is the only content and carries meaning. */
  title?: string;
  className?: string;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  color,
  style,
  title,
  className,
}: IconProps) {
  const paths = PATHS[name] ?? PATHS.info;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ color, flex: 'none', display: 'block', ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {paths.map(([tag, props], i) => {
        const Tag = tag as 'path';
        return <Tag key={i} {...(props as object)} />;
      })}
    </svg>
  );
}
