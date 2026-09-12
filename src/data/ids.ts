/**
 * Client-side UUID generation.
 *
 * TECHNICAL_SPECIFICATION section 5 requires stable UUID primary keys rather
 * than autoincrement integers, even with no sync target, so that a future
 * migration never has to renumber every row and every foreign key.
 */

/** A v4 UUID. Uses the platform generator when available. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  // Fallback for older browsers and non-secure contexts, where randomUUID is
  // absent but getRandomValues usually is not.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Set the version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Timestamp fields for a newly created entity. */
export function stamps(now: number = Date.now()) {
  return { createdAt: now, updatedAt: now, deletedAt: null as number | null };
}
