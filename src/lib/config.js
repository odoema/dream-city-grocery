// Runtime configuration.
//
// Each shop deploys the same build and points it at its own Supabase project
// through public/config.json (or VITE_SUPABASE_URL / VITE_SUPABASE_KEY at build
// time). Only a publishable/anon key belongs here — never a service-role key.

let cached = null;

export async function loadConfig() {
  if (cached) return cached;
  const env = import.meta.env || {};
  let file = {};
  try {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (res.ok) file = await res.json();
  } catch { /* offline or missing: fall back to build-time values */ }
  const supabaseUrl = String(file.supabaseUrl || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = String(file.supabaseKey || env.VITE_SUPABASE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
  const problems = [];
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(supabaseUrl) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(supabaseUrl)) {
    problems.push('supabaseUrl is missing or is not a Supabase project URL.');
  }
  if (!supabaseKey) problems.push('supabaseKey is missing.');
  if (/service_role|sb_secret_/i.test(supabaseKey) || keyRole(supabaseKey) === 'service_role') {
    problems.push('supabaseKey is a SECRET key. Replace it immediately with the publishable/anon key and rotate the secret.');
  }
  cached = { supabaseUrl, supabaseKey, problems };
  return cached;
}

function keyRole(key) {
  try {
    const part = key.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).role || null;
  } catch { return null; }
}
