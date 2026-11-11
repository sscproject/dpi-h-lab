import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface Config {
  port: number;
  host: string;
  /** Public origin used in join and owner links. Falls back to the request's own origin. */
  publicUrl?: string;
  databaseUrl?: string;
  pgliteDir?: string;
  jwtSecret: string;
  contentJson: string;
  clientDist: string;
  /** Per-IP limits (SPEC §11). */
  rateLimitPerMinute: number;
  /**
   * How many proxies in front of the app to trust for the client's IP (X-Forwarded-For).
   * false trusts none. Never "all": clients could then fake their IP and dodge rate limits.
   */
  trustProxy?: number | false;
  /** Development only: where Vite serves the pages; page requests to this server redirect there. */
  devClientUrl?: string;
  /** How often to auto-open and auto-close groups and events, in ms (0 turns it off). */
  sweepMs: number;
  /** Open groups and events with no activity for this many days close automatically (SPEC §4.4 X1). */
  idleDays: number;
  /** A closed group stays viewable with its team code for this many days (SPEC §4.4 X4). */
  codeReadDays: number;
  /** Shortest gap between two submissions from one team (milliseconds). */
  submitGapMs?: number;
}

function trustProxyHops(value: string): number | false {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error('TRUST_PROXY must be the number of proxies in front of the app (0 for none).');
  return n === 0 ? false : n;
}

export function loadConfig(env = process.env): Config {
  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production.');
    // Development: keep one secret on disk so restarts don't sign everyone out.
    const file = '.data/dev-jwt-secret';
    if (existsSync(file)) jwtSecret = readFileSync(file, 'utf8').trim();
    else {
      jwtSecret = randomBytes(32).toString('base64url');
      mkdirSync('.data', { recursive: true });
      writeFileSync(file, jwtSecret);
    }
    console.warn(`JWT_SECRET not set: using the development secret in ${file}.`);
  }
  // A short or example secret would let anyone forge sign-ins.
  if (env.NODE_ENV === 'production' && (jwtSecret.length < 32 || /change-?me|example|secret/i.test(jwtSecret))) {
    throw new Error('JWT_SECRET must be at least 32 random characters in production (see .env.example).');
  }
  return {
    port: Number(env.PORT ?? 3000),
    // Local runs stay on this machine; the container listens on all interfaces.
    host: env.HOST ?? (env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') || undefined,
    databaseUrl: env.DATABASE_URL || undefined,
    pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
    jwtSecret,
    contentJson: env.CONTENT_JSON ?? 'content/content.json',
    clientDist: env.CLIENT_DIST ?? 'dist-client',
    // Per address. A workshop room usually shares one address, so this must cover everyone joining at once.
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 120),
    // App Runner puts one proxy in front of the container; add one more for CloudFront.
    trustProxy: trustProxyHops(env.TRUST_PROXY ?? (env.NODE_ENV === 'production' ? '1' : '0')),
    sweepMs: Number(env.SWEEP_MS ?? 5000),
    idleDays: Number(env.IDLE_DAYS ?? 14),
    codeReadDays: Number(env.CODE_READ_DAYS ?? 90),
  };
}
