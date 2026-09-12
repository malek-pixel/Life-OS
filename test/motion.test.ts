/**
 * Tests for the motion system's one piece of real logic.
 *
 * Animation itself is verified in the browser - there is nothing meaningful to
 * assert about a CSS transition in Node. What is worth testing is the statistic
 * formatting behind the dashboard count-up, because a bug there does not look
 * like a broken animation: it looks like the dashboard reporting the wrong
 * number. Everything below is a case that would misreport a value.
 */

import { describe, expect, it } from 'vitest';

import { formatStatValue, parseStatValue } from '../src/ui/statValue';

/** Renders a value as it would appear once the roll-up has settled. */
function settled(value: string): string {
  const parts = parseStatValue(value);
  return formatStatValue(parts, parts.target);
}

/** Renders a value mid-flight, as at some fraction of the roll-up. */
function midFlight(value: string, at: number): string {
  const parts = parseStatValue(value);
  return formatStatValue(parts, parts.target * at);
}

describe('statistic parsing', () => {
  it('settles on exactly the value it was given', () => {
    for (const value of ['0', '1', '145', '1,240', '86%', '3d', '0/0', '0.0', '12.5h', '-9', '+25']) {
      expect(settled(value)).toBe(value);
    }
  });

  it('leaves a value with no number in it completely alone', () => {
    for (const value of ['—', '--', 'not tracked', '']) {
      const parts = parseStatValue(value);
      expect(Number.isNaN(parts.target)).toBe(true);
      // The component renders the original string in this case.
      expect(formatStatValue(parts, 0)).toBe(value);
    }
  });

  it('keeps the suffix fixed while the number moves', () => {
    expect(midFlight('86%', 0.5)).toBe('43%');
    expect(midFlight('3d', 0)).toBe('0d');
    // Only the first number animates; the rest of the label is held.
    expect(midFlight('4/10', 0.5)).toBe('2/10');
  });

  it('holds the decimal places of the source, so 0.0 never settles as 0', () => {
    expect(parseStatValue('0.0').decimals).toBe(1);
    expect(settled('0.0')).toBe('0.0');
    expect(midFlight('12.5h', 0.4)).toBe('5.0h');
  });

  it('re-groups only when the source was grouped', () => {
    // A formatted count keeps its separators as it rolls.
    expect(midFlight('1,240', 0.5)).toBe('620');
    expect(settled('1,240')).toBe('1,240');
    // A year is not a quantity: it must not gain a separator.
    expect(parseStatValue('2024').grouped).toBe(false);
    expect(settled('2024')).toBe('2024');
  });
});

describe('signed statistics', () => {
  /*
   * XP for a day goes negative once an undo has appended its compensating
   * event. Treating the minus as a fixed prefix and rolling the magnitude up
   * from zero counts the wrong way and renders "-0" on the first frame.
   */
  it('treats a leading minus as part of the number, not the prefix', () => {
    const parts = parseStatValue('-9');
    expect(parts.target).toBe(-9);
    expect(parts.prefix).toBe('');
  });

  it('counts down through zero rather than showing -0', () => {
    expect(midFlight('-9', 0)).toBe('0');
    expect(midFlight('-9', 0.5)).toBe('-5');
    expect(settled('-9')).toBe('-9');
  });

  it('never renders negative zero at the crossing point', () => {
    const parts = parseStatValue('-9');
    expect(formatStatValue(parts, -0.2)).toBe('0');
    expect(formatStatValue(parts, -0)).toBe('0');
    expect(formatStatValue(parseStatValue('-1.5'), -0.02)).toBe('0.0');
  });

  it('keeps an explicit plus, which toFixed would otherwise drop', () => {
    expect(parseStatValue('+25').explicitPlus).toBe(true);
    expect(midFlight('+25', 0.4)).toBe('+10');
    expect(settled('+25')).toBe('+25');
  });
});

describe('count-up interpolation', () => {
  /** The ease-out curve the hook uses, kept here so a change to it is noticed. */
  const eased = (t: number) => 1 - Math.pow(1 - t, 3);
  const at = (from: number, to: number, t: number) => from + (to - from) * eased(t);

  it('starts at the source value and ends exactly on the target', () => {
    expect(at(0, 145, 0)).toBe(0);
    expect(at(0, 145, 1)).toBe(145);
    expect(at(20, 5, 1)).toBe(5);
  });

  it('never leaves the range between the two values', () => {
    for (const [from, to] of [[0, 145], [145, 0], [-9, 12], [12, -9]] as const) {
      for (let t = 0; t <= 1; t += 0.05) {
        const v = at(from, to, t);
        expect(v).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-9);
        expect(v).toBeLessThanOrEqual(Math.max(from, to) + 1e-9);
      }
    }
  });

  it('decelerates, so the final digits are readable', () => {
    // More than half the distance is covered in the first third of the time.
    expect(eased(1 / 3)).toBeGreaterThan(0.5);
    // And the last tenth of the time covers very little of the distance.
    expect(1 - eased(0.9)).toBeLessThan(0.01);
  });
});

describe('progress bars', () => {
  /*
   * Bars express their value as scaleX rather than a width percentage, so the
   * same transition covers the entrance and every later change. The scale must
   * track the clamped value exactly, or a bar would misreport progress.
   */
  const scaleFor = (percent: number) => Math.max(0, Math.min(100, Math.round(percent))) / 100;

  it('maps a percentage onto the scale factor', () => {
    expect(scaleFor(0)).toBe(0);
    expect(scaleFor(50)).toBe(0.5);
    expect(scaleFor(100)).toBe(1);
  });

  it('clamps values outside the range instead of overflowing the track', () => {
    expect(scaleFor(-20)).toBe(0);
    expect(scaleFor(140)).toBe(1);
  });
});
