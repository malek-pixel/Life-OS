/**
 * Parsing and re-formatting for animated statistics.
 *
 * Kept separate from the component, and pure, so the rules below can be tested
 * without a DOM. They look trivial and are not: a statistic that renders "-0",
 * loses a "+", or silently reformats "2024" into "2,024" is showing the user a
 * number that is not the one the screen computed, which matters more than
 * whether it animated getting there.
 *
 * The input is the already-formatted string the screens produce today
 * ("1,240", "86%", "3d", "0/0", "-9", "—"), so no screen has to give up its
 * own formatting to gain a roll-up.
 */

export interface StatParts {
  /** Text before the number, e.g. a currency symbol. Never a sign. */
  prefix: string;
  /** The numeric value to animate toward. NaN when there is no number. */
  target: number;
  /** Text after the number, e.g. "%", "d", "/0". */
  suffix: string;
  /** Decimal places in the source, so "0.0" does not settle as "0". */
  decimals: number;
  /** Whether the source used thousands separators. */
  grouped: boolean;
  /** Whether the source carried an explicit "+". */
  explicitPlus: boolean;
}

/**
 * Splits a formatted statistic into an animatable number and its fixed parts.
 *
 * A leading sign is part of the *number*, not the prefix: pinning "-" in place
 * and rolling the magnitude up from zero counts the wrong way and renders "-0"
 * on the first frame. XP for a day can genuinely be negative once an undo has
 * appended a compensating event, so this is a real case.
 */
export function parseStatValue(value: string): StatParts {
  const match = /^([^\d+-]*)([+-]?\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(value);
  if (!match) {
    return { prefix: value, target: Number.NaN, suffix: '', decimals: 0, grouped: false, explicitPlus: false };
  }

  const raw = match[2]!.replace(/,/g, '');
  return {
    prefix: match[1]!,
    target: Number(raw),
    suffix: match[3]!,
    decimals: raw.includes('.') ? raw.split('.')[1]!.length : 0,
    grouped: match[2]!.includes(','),
    explicitPlus: raw.startsWith('+'),
  };
}

/** Renders an in-flight value back into the source's own formatting. */
export function formatStatValue(parts: StatParts, shown: number): string {
  if (!Number.isFinite(parts.target)) return parts.prefix;

  const rounded = shown.toFixed(parts.decimals);
  const body = parts.grouped
    ? Number(rounded).toLocaleString(undefined, {
        minimumFractionDigits: parts.decimals,
        maximumFractionDigits: parts.decimals,
      })
    : rounded;

  const signed = parts.explicitPlus && shown >= 0 ? `+${body}` : body;
  // "-0" is never a value anyone means; it only appears crossing zero.
  return parts.prefix + signed.replace(/^-0(\.0*)?$/, '0$1') + parts.suffix;
}
