// Fastify app: public team-code API, group owner API, staff API, the scheduled
// open/close sweep, and the built web client.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import { makeNotifier, type Ctx } from './context.js';
import type { Db } from './db.js';
import { sweep } from './events.js';
import { Hub } from './realtime.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';
import { SetupCode } from './staff.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Runs the open/close sweep now (tests and the interval below). */
    sweepNow(): Promise<void>;
    setup: SetupCode;
    db: Db;
  }
}

/** Trusts only the nearest `hops` proxies, so the client IP can't be faked with X-Forwarded-For. */
const trustHops = (hops: number | false) => (hops ? (_addr: string, i: number) => i < hops : false);

export async function buildApp(db: Db, config: Config) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: trustHops(config.trustProxy ?? false) });
  app.decorate('db', db);
  // Unexpected errors are logged in full but never shown to the browser (OWASP A05).
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'server_error', message: 'Something went wrong. Please try again.' });
    }
    return reply.code(status).send({ error: status === 429 ? 'rate_limited' : 'invalid', message: err.message });
  });
  const hub = new Hub();
  const setup = new SetupCode();
  const { notify, notifyCard } = makeNotifier(db, hub);
  hub.onPresence = notifyCard;

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { global: false });

  const ctx: Ctx = {
    app, db, config, hub, setup, notify, notifyCard,
    origin: (req: FastifyRequest) => config.publicUrl ?? `${req.protocol}://${req.host}`,
    limited: { config: { rateLimit: { max: config.rateLimitPerMinute, timeWindow: '1 minute' } } },
  };

  app.decorate('setup', setup);
  app.decorate('sweepNow', async () => notify(await sweep(db, { idleDays: config.idleDays })));

  // Auto-open at start times and auto-close at end times (SPEC §4.2), every few seconds.
  if (config.sweepMs > 0) {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try { await app.sweepNow(); } catch (e) { app.log.error(e, 'sweep failed'); } finally { running = false; }
    }, config.sweepMs);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  app.addHook('onClose', async () => hub.close());

  app.register(async (api) => {
    await api.register(publicRoutes(ctx));
    await api.register(staffRoutes(ctx));
  }, { prefix: '/api/v1' });

  // Development: pages are served live by Vite, so send browsers there rather than serve a
  // built copy that goes stale as the code changes.
  if (config.devClientUrl) {
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.redirect(`${config.devClientUrl}${req.url}`);
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
    return app;
  }

  // Serve the built client and fall back to index.html for client-side routes.
  const dist = resolve(config.clientDist);
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Not found.' });
    });
  }

  return app;
}
