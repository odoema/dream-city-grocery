// Small shared app state: who is signed in and how the shop is configured.

export const state = {
  config: null,
  session: null,
  profile: null,          // { id, full_name, role, active }
  settings: null,         // store_settings row (or public profile before sign-in)
  publicProfile: null
};

export const ROLES = ['owner', 'manager', 'accountant', 'cashier', 'executive_director'];

export const can = {
  manageCatalogue: () => is('owner', 'manager'),
  manageCustomers: () => is('owner', 'manager'),
  purchase: () => is('owner', 'manager', 'accountant'),
  countStock: () => is('owner', 'manager', 'accountant'),
  accounts: () => is('owner', 'manager', 'accountant'),
  refund: () => is('owner', 'manager'),
  overridePrice: () => is('owner', 'manager'),
  discount: () => is('owner', 'manager') || Boolean(state.settings?.allow_cashier_discounts),
  importData: () => is('owner', 'manager'),
  staff: () => is('owner', 'manager'),
  editStaff: () => is('owner'),
  settings: () => is('owner')
};

export function is(...roles) {
  return Boolean(state.profile && roles.includes(state.profile.role));
}

export function roleLabel(role) {
  return {
    owner: 'Owner',
    manager: 'Manager',
    accountant: 'Accountant',
    cashier: 'Cashier',
    executive_director: 'Executive Director'
  }[role] || role;
}
