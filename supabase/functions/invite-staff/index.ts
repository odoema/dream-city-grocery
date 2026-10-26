// Supabase Edge Function: invite a staff member by email (owner only).
// Deploy:  supabase functions deploy invite-staff
// The service-role key is provided automatically to Edge Functions; it never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.81.1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const ROLES = ['owner', 'manager', 'accountant', 'cashier'];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';

  // Who is calling? Must be an active owner.
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: me } = await asCaller.auth.getUser();
  if (!me?.user) return reply({ error: 'Sign in first' }, 401);
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: caller } = await admin.from('profiles').select('role,active').eq('id', me.user.id).maybeSingle();
  if (!caller || !caller.active || caller.role !== 'owner') return reply({ error: 'Only the owner can invite staff' }, 403);

  const { email, full_name, role = 'cashier', redirect_to } = await req.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply({ error: 'Enter a valid email' }, 400);
  if (!ROLES.includes(role)) return reply({ error: 'Unknown role' }, 400);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: full_name ?? '' }, redirectTo: redirect_to });
  if (error) return reply({ error: error.message }, 400);
  const id = data.user?.id;
  if (id) {
    await admin.from('profiles').upsert({ id, full_name: full_name ?? '', role, active: true, updated_at: new Date().toISOString() });
    await admin.from('audit_log').insert({ actor_id: me.user.id, action: 'staff.invited', entity_type: 'profile', entity_id: id, details: { email, role } });
  }
  return reply({ ok: true, id });
});
