import { createClient } from '@supabase/supabase-js';

// The one and only Supabase client in the app.
let client = null;

export function initClient({ supabaseUrl, supabaseKey }) {
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

export function db() {
  if (!client) throw new Error('Supabase client not initialised');
  return client;
}

// Call a database function and throw a readable error on failure.
export async function rpc(name, args = {}) {
  const { data, error } = await db().rpc(name, args);
  if (error) throw friendlyError(error);
  return data;
}

// Run a query builder and throw on error.
export async function run(query) {
  const { data, error, count } = await query;
  if (error) throw friendlyError(error);
  return count !== undefined && count !== null ? { data, count } : data;
}

export function friendlyError(error) {
  if (!error) return new Error('Unknown error');
  const msg = String(error.message || error.error_description || error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return new Error('No connection to the server. Check the internet connection and try again.');
  }
  if (/JWT expired|invalid JWT/i.test(msg)) return new Error('Your session expired. Please sign in again.');
  if (/permission denied/i.test(msg)) return new Error('You do not have permission to do that.');
  if (/Could not find the function/i.test(msg)) {
    return new Error('The database is missing an update for this feature. Ask the administrator to apply the latest migrations.');
  }
  const e = new Error(msg.replace(/^.*?ERROR:\s*/, ''));
  e.code = error.code;
  return e;
}
