import { h, clear, table } from '../lib/dom.js';
import { db, rpc } from '../lib/supabase.js';
import { state, can, roleLabel, ROLES } from '../lib/state.js';
import { dateTime } from '../lib/format.js';
import { pageHeader, card, formModal, toast, showError, badge, loading } from '../lib/ui.js';

const ROLE_HELP = {
  owner: 'Everything, including settings and staff.',
  manager: 'Sell, products, prices, discounts, refunds, buying, counts, accounts.',
  accountant: 'Buying, supplier payments, counts, accounts and reports.',
  cashier: 'Sell, receive customer payments, view products and own sales.',
  executive_director: 'Read-only oversight: dashboard, reports, products, customers, inventory and financial information. Cannot operate the POS, change settings or manage staff.'
};

export async function render(root) {
  const host = h('div');
  clear(root, pageHeader('Staff', 'Who can use the system and what they can do.',
    can.editStaff() ? h('button', { class: 'primary', onclick: invite }, '+ Add staff member') : null), host);

  async function load() {
    loading(host);
    try {
      const staff = await rpc('list_staff');
      clear(host,
        card(null, table([
          { label: 'Name', value: s => h('div', null, h('b', null, s.full_name || '—'), h('small', { class: 'block muted' }, s.email || '')) },
          { label: 'Role', value: s => roleLabel(s.role) },
          { label: 'Status', value: s => badge(s.active ? 'active' : 'switched off', s.active ? 'ok' : 'muted') },
          { label: 'Since', value: s => dateTime(s.created_at) },
          { label: '', class: 'actions', value: s => can.editStaff() ? h('button', { class: 'link', onclick: () => edit(s) }, 'Change') : '' }
        ], staff)),
        card('What each role can do', h('dl', { class: 'statement' }, ROLES.map(r => [h('dt', { class: 'strong' }, roleLabel(r)), h('dd', null, ROLE_HELP[r])]))));
    } catch (e) { showError(e); clear(host, h('p', { class: 'muted' }, e.message)); }
  }

  function edit(s) {
    formModal({
      title: s.full_name || s.email, subtitle: s.email,
      fields: [
        { name: 'full_name', label: 'Name', value: s.full_name, required: true, full: true },
        { name: 'role', label: 'Role', type: 'select', value: s.role, options: ROLES.map(r => ({ value: r, label: roleLabel(r) + ' — ' + ROLE_HELP[r] })), full: true },
        { name: 'active', label: 'Can sign in', type: 'checkbox', value: s.active, hint: 'Switch off when someone leaves. Their history is kept.' }
      ],
      onSubmit: async v => {
        await rpc('set_staff_member', { p_user_id: s.id, p_full_name: v.full_name, p_role: v.role, p_active: v.active });
        toast('Saved.');
        if (s.id === state.profile.id && (v.role !== 'owner' || !v.active)) location.reload();
        await load();
      }
    });
  }

  function invite() {
    formModal({
      title: 'Add a staff member',
      subtitle: 'They receive an email to set their password. They start as a cashier — change the role after they appear in the list.',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true, full: true },
        { name: 'full_name', label: 'Name', required: true, full: true },
        { name: 'role', label: 'Role', type: 'select', value: 'cashier', options: ROLES.map(r => ({ value: r, label: roleLabel(r) })) }
      ],
      submitLabel: 'Send invitation',
      onSubmit: async v => {
        const { data, error } = await db().functions.invoke('invite-staff', { body: { email: v.email, full_name: v.full_name, role: v.role, redirect_to: location.origin + location.pathname } });
        if (error) {
          throw new Error('Invitations are not switched on for this shop yet. Either deploy the "invite-staff" function (see SETUP.md), or add the person in Supabase → Authentication → Users and then set their role here.');
        }
        if (data?.error) throw new Error(data.error);
        toast('Invitation sent to ' + v.email + '.');
        await load();
      }
    });
  }

  await load();
}
