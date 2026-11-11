// Content versions live in the content_versions table. On start, a bundled content.json
// whose version is not in the table yet is published and becomes active. Published
// versions never change, so groups keep the wording they started with (FR-A5).

import { readFileSync } from 'node:fs';
import { validateContent, type Content } from '../shared/content.js';
import type { Db } from './db.js';

export async function seedContent(db: Db, file: string): Promise<string> {
  const content = JSON.parse(readFileSync(file, 'utf8')) as Content;
  const { rows } = await db.query('SELECT 1 FROM content_versions WHERE version = $1', [content.version]);
  if (rows.length) return (await activeContentVersion(db)) ?? content.version;
  const errors = validateContent(content);
  if (errors.length) throw new Error(`Bundled content is not valid:\n${errors.join('\n')}`);
  await db.tx(async (q) => {
    await q.query('UPDATE content_versions SET is_active = false WHERE is_active');
    await q.query('INSERT INTO content_versions (version, json, is_active) VALUES ($1, $2::jsonb, true)', [content.version, JSON.stringify(content)]);
  });
  return content.version;
}

export async function activeContentVersion(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ version: string }>('SELECT version FROM content_versions WHERE is_active');
  return rows[0]?.version ?? null;
}

export async function getContent(db: Db, version: string): Promise<Content | null> {
  const { rows } = await db.query<{ json: Content }>('SELECT json FROM content_versions WHERE version = $1', [version]);
  return rows[0]?.json ?? null;
}
