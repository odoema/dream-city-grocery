// Applies the repository migrations to an in-memory Postgres (PGlite) with
// minimal Supabase stand-ins (auth schema, roles, storage) so SQL can be
// syntax-checked and exercised without touching any real project.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
export const REPO = process.env.REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
`;

export function migrationFiles() {
  const dir = path.join(REPO, 'supabase/migrations');
  return fs.readdirSync(dir).filter(f => /^\d{14}_.*\.sql$/.test(f)).sort().map(f => path.join(dir, f));
}

export async function freshDb({ upTo } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUBS);
  for (const file of migrationFiles()) {
    if (upTo && path.basename(file) > upTo) break;
    const sql = fs.readFileSync(file, 'utf8');
    try { await db.exec(sql); }
    catch (e) { e.message = path.basename(file) + ': ' + e.message; throw e; }
  }
  return db;
}

export async function as(db, userId) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId || ''}', false)`);
}
