import { mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { seedContent } from './content-store.js';
import { pgDb, pgliteDb } from './db.js';
import { migrate } from './migrate.js';
import { adoptOrphanGroups } from './events.js';

const config = loadConfig();
// `--port` wins over PORT, so the dev API keeps port 3000 even when a tool sets PORT for the web client.
const portArg = process.argv.indexOf('--port');
if (portArg > 0) config.port = Number(process.argv[portArg + 1]);
// `--dev-client <url>`: page requests redirect to the live Vite server (development only).
const devArg = process.argv.indexOf('--dev-client');
if (devArg > 0) config.devClientUrl = process.argv[devArg + 1];
let db;
if (config.databaseUrl) {
  db = pgDb(config.databaseUrl);
} else {
  mkdirSync(config.pgliteDir!, { recursive: true });
  console.warn(`DATABASE_URL not set: using embedded PGlite database in ${config.pgliteDir}`);
  db = await pgliteDb(config.pgliteDir);
}

await migrate(db);
await seedContent(db, config.contentJson);
// Older groups (do-it-yourself, or asking to join a workshop) move into one open session.
const adopted = await adoptOrphanGroups(db);
const app = await buildApp(db, config);

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
// First run: print the one-time code needed to create the admin account in the app.
await app.setup.refresh(db, (msg) => app.log.warn(msg));
if (process.env.NODE_ENV === 'production' && !config.publicUrl) {
  app.log.warn('PUBLIC_URL is not set: join links and QR codes use the address each request came in on. Set it to the public site address.');
}
if (adopted) app.log.info(`Moved ${adopted} earlier group(s) into the "Earlier groups" open session.`);
