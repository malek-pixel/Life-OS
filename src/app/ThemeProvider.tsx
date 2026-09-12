/**
 * Applies design tokens and accessibility preferences to the document.
 *
 * Tokens are injected once as CSS custom properties, then the few that the user
 * can change (accent, text scale, contrast, motion, density) are written onto
 * <html> as overrides. That keeps a setting change instant and global without
 * every component subscribing to settings itself.
 */

import { useEffect, type ReactNode } from 'react';

import { cssVariables } from '../design/tokens';
import { useSettings } from './hooks';

/** Injected once; static values that never change at runtime. */
const STYLE_ID = 'life-os-tokens';

function ensureTokenStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `:root {\n  ${cssVariables()}\n}`;
  document.head.appendChild(style);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();

  useEffect(() => {
    ensureTokenStyles();
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    // Accent is user-selectable, so it overrides the token default. The derived
    // tints are recomputed from it rather than hardcoded, so a custom accent
    // still produces a coherent set of washes and borders.
    root.style.setProperty('--c-accent', settings.accent);
    root.style.setProperty('--c-accent-text', lighten(settings.accent, 0.3));
    root.style.setProperty('--c-accent-bright', lighten(settings.accent, 0.15));
    root.style.setProperty('--c-accent-deep', darken(settings.accent, 0.3));
    root.style.setProperty('--c-accent-wash', alpha(settings.accent, 0.08));
    root.style.setProperty('--c-accent-wash-strong', alpha(settings.accent, 0.16));
    root.style.setProperty('--c-accent-border', alpha(settings.accent, 0.4));
    root.style.setProperty('--c-accent-border-soft', alpha(settings.accent, 0.35));
    root.style.setProperty('--c-accent-border-strong', alpha(settings.accent, 0.45));
    root.style.setProperty('--c-accent-selection', alpha(settings.accent, 0.25));
  }, [settings.accent]);

  useEffect(() => {
    const root = document.documentElement;
    // Booleans are written as data attributes so global.css can key off them.
    root.dataset.reduceMotion = String(settings.reduceMotion);
    root.dataset.highContrast = String(settings.highContrast);
    root.dataset.largeText = String(settings.largeText || settings.fontScale === 'L');
    root.dataset.compact = String(settings.compactRows);
    if (settings.fontScale === 'S') root.style.setProperty('--fs-base', '11.5px');
    else root.style.removeProperty('--fs-base');
  }, [
    settings.reduceMotion,
    settings.highContrast,
    settings.largeText,
    settings.compactRows,
    settings.fontScale,
  ]);

  return <>{children}</>;
}

/* ------------------------------------------------------------------ *
 * Colour helpers
 *
 * Small and local on purpose - a colour library would be a dependency for
 * three functions, which section 60 rules out.
 * ------------------------------------------------------------------ */

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function darken(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
