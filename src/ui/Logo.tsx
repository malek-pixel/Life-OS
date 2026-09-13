/**
 * The Life OS mark and wordmark.
 *
 * The geometry is the same as public/logo-mark.svg and the app icons - all of
 * them are generated from scripts/make-icons.js - so the in-app logo cannot
 * drift from the Home Screen icon.
 */

import { useFieldId } from '../app/hooks';

export function LogoMark({ size = 32 }: { size?: number }) {
  // Gradient ids must be unique per instance, or two logos on one page would
  // share (and fight over) the first one's definitions.
  const id = useFieldId('logo');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-v`} gradientUnits="userSpaceOnUse" x1="71" y1="8" x2="73" y2="80">
          <stop offset="0" stopColor="#c81640" />
          <stop offset="1" stopColor="#4a0718" />
        </linearGradient>
        <linearGradient id={`${id}-h`} gradientUnits="userSpaceOnUse" x1="20" y1="88" x2="76" y2="80">
          <stop offset="0" stopColor="#c81640" />
          <stop offset="1" stopColor="#4a0718" />
        </linearGradient>
      </defs>
      <polygon points="30,76 64,74 82,84 14,96" fill={`url(#${id}-h)`} />
      <polygon points="62,14 80,4 82,84 64,74" fill={`url(#${id}-v)`} />
    </svg>
  );
}

/** "LIFE OS" set wide, with OS in the accent - as in the brand lockup. */
export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 500,
        letterSpacing: '0.32em',
        // Letter-spacing adds trailing space after the last letter; pull it back
        // so the wordmark stays optically centred.
        marginRight: '-0.32em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--c-text)' }}>LIFE</span>{' '}
      <span style={{ color: '#d0234c' }}>OS</span>
    </span>
  );
}
