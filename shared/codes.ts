// Team and event codes (SPEC §9.1): 6 characters of Crockford base32 (no I, L, O, U).

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Uppercases, strips spaces, dashes and other punctuation, and maps the look-alike
 * letters Crockford excludes (O → 0, I and L → 1).
 */
export function normalizeCode(input: string): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** "ABC123" → "ABC-123". */
export function formatTeamCode(code: string): string {
  const c = normalizeCode(code);
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

export function isCodeShape(code: string): boolean {
  return code.length === 6 && [...code].every((ch) => CROCKFORD.includes(ch));
}

/** Random 6-character code from a source of random bytes (injected so it works in Node and tests). */
export function makeCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(6);
  return [...bytes].map((b) => CROCKFORD[b % 32]).join('');
}

/** A workshop code ("E-ABC123"): one character longer than a team code, starting with E. */
export function isWorkshopCode(input: string): boolean {
  const c = normalizeCode(input);
  return c.length === 7 && c.startsWith('E') && isCodeShape(c.slice(1));
}
