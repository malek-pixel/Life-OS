/**
 * Life OS design tokens.
 *
 * Single source of truth for every visual value in the app. Extracted verbatim
 * from the approved design (`Life OS.dc.html`). Per the master prompt section 12,
 * no arbitrary colour/spacing/radius literals belong in feature code — if a value
 * is needed and missing here, it gets added here first.
 *
 * Consumed two ways:
 *  - as CSS custom properties (see `cssVariables()`, injected once in global.css)
 *  - as typed TS values, for the places that compute style (charts, SVG, canvas)
 */

export const color = {
  /* --- surfaces, darkest to lightest --- */
  bgRoot: '#09090C',
  bgApp: '#0B0B0F',
  bgPanel: '#0E0E13',
  bgCard: '#121218',
  bgRaised: '#16161D',

  /* --- text, brightest to dimmest --- */
  text: '#F2F2F4',
  textStrong: '#E2E2E6',
  textBody: '#D6DBE6',
  textSecondary: '#C9CAD2',
  textMuted: '#A6A7B0',
  textDim: '#8A8B94',
  textFaint: '#82838D',
  textGhost: '#6A6B74',
  textDisabled: '#55565F',

  /* --- accent: burgundy. "Burgundy = you", per the design system --- */
  accent: '#9E304A',
  accentDeep: '#6E1F32',
  accentBright: '#C0506A',
  accentText: '#D4708A',

  /* --- blue. "Blue = AI", per the design system --- */
  ai: '#4C6FAE',
  aiBright: '#7B9AD0',
  aiMid: '#6E8FD1',

  /* --- semantic --- */
  danger: '#C23A54',
  dangerBright: '#E0637A',
  dangerDeep: '#D6435C',
  warn: '#B5566B',
  warnBright: '#C25B72',
  success: '#7BB08A',
  neutral: '#9E7BB0',

  /* --- hairlines. The design uses exactly these four alpha steps. --- */
  border: 'rgba(255,255,255,.09)',
  borderSoft: 'rgba(255,255,255,.07)',
  borderFaint: 'rgba(255,255,255,.06)',
  borderGhost: 'rgba(255,255,255,.04)',
  borderStrong: 'rgba(255,255,255,.15)',
  borderInput: 'rgba(255,255,255,.2)',

  /* --- fills --- */
  fill: 'rgba(255,255,255,.07)',
  fillHover: 'rgba(255,255,255,.06)',
  fillActive: 'rgba(255,255,255,.08)',
  fillSubtle: 'rgba(255,255,255,.028)',
  fillGhost: 'rgba(255,255,255,.03)',
  fillTrack: 'rgba(255,255,255,.16)',
  fillMiss: 'rgba(194,58,84,.35)',

  accentWash: 'rgba(158,48,74,.08)',
  accentWashStrong: 'rgba(158,48,74,.16)',
  accentBorder: 'rgba(158,48,74,.4)',
  accentBorderSoft: 'rgba(158,48,74,.35)',
  accentBorderStrong: 'rgba(158,48,74,.45)',
  accentSelection: 'rgba(158,48,74,.25)',

  aiWash: 'rgba(76,111,174,.12)',
  aiWashSoft: 'rgba(76,111,174,.14)',
  aiBorder: 'rgba(76,111,174,.25)',
  aiBorderSoft: 'rgba(76,111,174,.35)',

  scrim: 'rgba(6,6,9,.72)',
} as const;

/** Life-area and status hues. Kept as a named map so charts and badges agree. */
export const areaColor = {
  Education: '#7B9AD0',
  Career: '#D4708A',
  Fitness: '#4C6FAE',
  Mind: '#7BB08A',
  Projects: '#C25B72',
  Relationships: '#9E7BB0',
  Other: '#8A8B94',
} as const;

export const font = {
  ui: "'Space Grotesk', system-ui, -apple-system, Segoe UI, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** Type scale. The design works in half-pixels; these are its literal values. */
export const fontSize = {
  '3xs': '9px',
  '2xs': '10.5px',
  xs: '11px',
  sm: '11.5px',
  base: '12px',
  md: '12.5px',
  lg: '13px',
  xl: '13.5px',
  '2xl': '15px',
  '3xl': '16px',
  '4xl': '19px',
  '5xl': '22px',
  '6xl': '26px',
  '7xl': '34px',
} as const;

export const fontWeight = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;

export const letterSpacing = { tight: '.02em', wide: '.08em' } as const;

/** 4px base grid. */
export const space = {
  0: '0',
  1: '2px',
  2: '4px',
  3: '6px',
  4: '8px',
  5: '10px',
  6: '12px',
  7: '14px',
  8: '16px',
  9: '18px',
  10: '20px',
  11: '22px',
  12: '26px',
  14: '32px',
  16: '40px',
} as const;

export const radius = {
  xs: '4px',
  sm: '5px',
  md: '6px',
  lg: '7px',
  xl: '8px',
  '2xl': '9px',
  '3xl': '11px',
  '4xl': '13px',
  '5xl': '14px',
  full: '999px',
} as const;

export const shadow = {
  card: '0 14px 34px -16px rgba(0,0,0,.75)',
  panel: '0 40px 120px -30px rgba(0,0,0,.85), 0 0 0 1px rgba(0,0,0,.5)',
  overlay: '0 30px 90px -20px rgba(0,0,0,.9)',
  accentGlow: `0 0 12px -1px ${color.accent}`,
} as const;

/**
 * Motion. Durations are deliberately short; `ease` is the design's single
 * entrance curve and `press` its single overshoot curve.
 */
export const motion = {
  instant: '.14s',
  fast: '.16s',
  quick: '.2s',
  normal: '.25s',
  entrance: '.42s',
  stagger: '.5s',
  bar: '.9s',
  ease: 'cubic-bezier(.22,.61,.36,1)',
  press: 'cubic-bezier(.34,1.4,.64,1)',
  /** Screen skeleton dwell. Matches the design's `go()` timing. */
  screenLoadMs: 360,
  /** Toast lifetime. Matches the design's `showToast()`. */
  toastMs: 3400,
  /** Counter roll-up duration. Matches the design's `animateCounters()`. */
  countUpMs: 850,
} as const;

export const layout = {
  sidebarWidth: 236,
  sidebarCollapsedWidth: 64,
  topbarHeight: 56,
  contentMaxWidth: 1180,
  /** Below this the sidebar collapses to icons on its own. */
  breakpointCompact: 1100,
  /** Below this the sidebar becomes an overlay drawer. */
  breakpointNarrow: 820,
} as const;

export const zIndex = {
  base: 0,
  sticky: 10,
  sidebar: 20,
  drawer: 40,
  overlay: 50,
  palette: 60,
  toast: 70,
} as const;

/** Flattens the token objects into the CSS custom properties used by global.css. */
export function cssVariables(): string {
  const lines: string[] = [];
  const push = (prefix: string, obj: Record<string, string | number>) => {
    for (const [k, v] of Object.entries(obj)) {
      lines.push(`--${prefix}-${kebab(k)}: ${v};`);
    }
  };
  push('c', color as unknown as Record<string, string>);
  push('area', areaColor as unknown as Record<string, string>);
  push('fs', fontSize as unknown as Record<string, string>);
  push('sp', space as unknown as Record<string, string>);
  push('r', radius as unknown as Record<string, string>);
  push('sh', shadow as unknown as Record<string, string>);
  lines.push(`--font-ui: ${font.ui};`);
  lines.push(`--font-mono: ${font.mono};`);
  lines.push(`--ease: ${motion.ease};`);
  lines.push(`--ease-press: ${motion.press};`);
  return lines.join('\n  ');
}

function kebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
