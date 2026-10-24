# Dream City Grocery — dedicated Supabase setup

This guide is for the dedicated project **Dream-City-Grocery** (\`nohdgmylncjtdymfshfy\`) only.

**Never run the migration against SmartAttend or its Supabase project.** Do not reset a database or drop existing objects. The migration is versioned at \`supabase/migrations/20261024000100_initial_schema.sql\` and is intended for the dedicated project whose \`public\` schema was inspected as empty.

## 1. Apply the migration

1. Open https://supabase.com/dashboard/project/nohdgmylncjtdymfshfy/sql/new
2. Open \`supabase/migrations/20261024000100_initial_schema.sql\` from this repository branch.
3. Review that the project selector shows **Dream-City-Grocery / nohdgmylncjtdymfshfy**.
4. Run the migration in the dedicated project SQL editor. Do not run it in SmartAttend.
5. Confirm the tables, policies, \`complete_sale\` function, \`product-images\` private bucket, and chart-of-accounts seed rows exist.

The migration is transactional. If it fails, inspect the exact error and current project state before retrying; do not reset the project.

## 2. Configure the public browser key

1. In the dedicated project's dashboard, open **Project Settings → API** (or API Keys).
2. Copy the project's **publishable key** (preferred) or legacy **anon/public key**.
3. Edit \`supabase-config.js\` and replace \`REPLACE_WITH_DEDICATED_PROJECT_PUBLISHABLE_OR_ANON_KEY\`.
4. The URL is already set to \`https://nohdgmylncjtdymfshfy.supabase.co\`.

The publishable/anon key is intended for browser use with RLS. **Never use the service-role/secret key in \`supabase-config.js\`, \`app.js\`, HTML, or any client-side code.**

## 3. Create the first staff login

1. In Supabase **Authentication → Users**, create a staff user with email/password. Keep public sign-up disabled.
2. The migration's auth trigger creates a profile with the default \`cashier\` role.
3. In the SQL editor for the dedicated project only, promote the intended first owner. Replace the email and display name with the actual values:

\`\`\`sql
update public.profiles p
set role = 'owner', full_name = 'Dream City Owner', updated_at = now()
from auth.users u
where u.id = p.id
  and lower(u.email) = lower('OWNER_EMAIL_HERE');
\`\`\`

4. Confirm exactly one intended profile was updated. Do not paste passwords or secret keys into chat or source code.
5. Create additional staff through the Auth dashboard. New profiles default to cashier. Role changes should be performed by the owner using a reviewed administrative workflow; direct profile role editing is intentionally not exposed in the browser UI.

## 4. Deploy and smoke-test

The current GitHub Pages workflow deploys the repository root when changes reach \`main\`. Review and merge the integration branch only after checking the diff. Once deployed, test the public site over HTTPS:

- Staff sign-in and sign-out.
- Cashier can search products and complete a sale at listed prices.
- Cashier cannot create products or apply discounts.
- Owner/manager can add a product and authorize a discount no greater than the subtotal.
- Cash and credit sales both post successfully; credit requires an active customer and stays within the configured credit limit.
- A completed sale reduces stock and records inventory movement, sale items, a balanced journal, and an audit event.
- Insufficient stock, inactive products, non-zero tax, invalid discount, missing customer, and repeated product lines fail without partial writes.
- A successful sale returns a receipt number and opens a printable receipt.
- Image upload works only for authenticated owner/manager users after image upload UI is added.

## MVP scope and limitations

The current branch adds staff login, live product reads, manager product creation, atomic checkout RPC calls, recent sales, and printable receipts. Purchases, supplier receiving, refunds/voids, financial statement pages, product image upload UI, and a full stock-adjustment workflow are not implemented in this MVP branch. The private \`product-images\` bucket and RLS policies are provisioned for a later upload UI.

The dashboard only derives today's sales from the latest 30 records loaded by the UI; it is not a full-day accounting report. Validate financial totals in SQL before using them for management decisions.

## Important accounting choices

- Tax is rejected unless it is zero; do not enable tax until the correct tax liability/accounting treatment is decided.
- Card and mobile money are mapped to account \`1010\` per the current MVP policy; bank transfer maps to \`1020\`.
- Discounts are posted as a debit to \`4900 Sales Returns & Discounts\`, while sales revenue is credited before discount. This keeps the journal balanced.
- Credit sales debit Accounts Receivable (\`1100\`) and require an active customer.
- The credit-limit MVP check sums completed credit sales; a customer payment/credit-settlement workflow is not yet implemented. Do not treat the displayed total as a full receivables ledger until settlement functionality exists.


## 6. Enable purchasing and accounts payable

The purchasing module is a second, additive migration. It does not reset or drop existing tables.

1. Open the SQL Editor for **Dream-City-Grocery / nohdgmylncjtdymfshfy** only: https://supabase.com/dashboard/project/nohdgmylncjtdymfshfy/sql/new
2. Open `supabase/migrations/20261024000200_purchasing_ap.sql` from the main branch: https://github.com/odoema/dream-city-grocery/blob/main/supabase/migrations/20261024000200_purchasing_ap.sql
3. Copy the SQL file contents only (do not include Markdown fences) into the SQL Editor and run it once.
4. Confirm the new tables exist: `purchase_orders`, `purchase_order_items`, `supplier_invoices`, `supplier_invoice_items`, `goods_receipts`, and `supplier_payments`.
5. Refresh https://odoema.github.io/dream-city-grocery/ and sign in as the owner.

The purchasing UI supports supplier records, purchase orders, goods receipt with supplier invoice posting, inventory movements, balanced Inventory/Accounts Payable journals, and supplier payments. Posting a received invoice is atomic. Invoice numbers and payment references are checked for duplicates. Goods received against a purchase order are checked against the outstanding ordered quantities.

**Operational note:** the UI currently uses guided prompts for purchase-order and invoice line entry. Verify supplier invoices and stock quantities carefully before confirming. Tax is not included; tax handling remains disabled pending the business tax policy. The Balance Sheet and Cash Flow Statement still need a dedicated reporting pass.
