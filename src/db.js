import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const all = async (text, params) => (await pool.query(text, params)).rows;

// Run fn inside a transaction; fn receives a client with the same q/one/all helpers.
export async function tx(fn) {
  const client = await pool.connect();
  const c = {
    q: (t, p) => client.query(t, p),
    one: async (t, p) => (await client.query(t, p)).rows[0] ?? null,
    all: async (t, p) => (await client.query(t, p)).rows,
  };
  try {
    await client.query('begin');
    const result = await fn(c);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await q('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const dir = path.join(root, 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((await all('select name from schema_migrations')).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async (c) => {
      await c.q(sql);
      await c.q('insert into schema_migrations (name) values ($1)', [f]);
    });
    console.log(`migrated ${f}`);
  }
}
