// Applies server/migrations/*.sql in name order, once each.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';

export async function migrate(db: Db, dir = join(process.cwd(), 'server', 'migrations')): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(file);
  }
  return applied;
}
