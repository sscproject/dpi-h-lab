// Thin database layer over PostgreSQL. Two drivers share one interface:
//  - `pg` when DATABASE_URL is set (docker compose, AWS RDS)
//  - PGlite (Postgres compiled to WebAssembly) otherwise, for local runs and tests without Docker.
// All SQL is parameterised; JSON values are passed as text and cast with ::jsonb.

import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => { await pool.query(sql); },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** `dataDir` undefined → in-memory database (tests). */
export async function pgliteDb(dataDir?: string): Promise<Db> {
  const db = await PGlite.create(dataDir, { extensions: { citext } });
  return {
    query: (sql, params) => db.query(sql, params as unknown[]) as never,
    exec: async (sql) => { await db.exec(sql); },
    tx: (fn) => db.transaction((t) => fn({ query: (sql, params) => t.query(sql, params as unknown[]) as never })),
    close: () => db.close(),
  };
}

/** True for a UUID; other ids can never match a row, so lookups return "not found" straight away. */
export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
