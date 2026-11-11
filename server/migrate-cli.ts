import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.js';
import { pgDb, pgliteDb } from './db.js';
import { migrate } from './migrate.js';

const config = loadConfig();
if (!config.databaseUrl) mkdirSync(config.pgliteDir!, { recursive: true });
const db = config.databaseUrl ? pgDb(config.databaseUrl) : await pgliteDb(config.pgliteDir);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.close();
