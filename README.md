# Grocery POS — white-label point of sale, stock and accounts

A complete, mobile-friendly system for a grocery or small shop: **sell, buy, count stock, track customers' credit, and see real profit** — with proper double-entry accounting underneath. It started as Dream City Grocery's system and is now built so **any shop can run its own copy** with its own name, logo, currency and database.

Live (Dream City): https://odoema.github.io/dream-city-grocery/

| For staff | For owners |
|---|---|
| Fast till with barcode scanning, weighed items, cash change | Today's sales, profit and cash at a glance |
| Customer credit and repayments | Profit & loss, balance sheet, trial balance |
| Record purchases in one form | Smart shopping list from real sales |
| Guided stock counts, stock adjustments, supplier returns | Refunds, discounts and price changes are controlled and audited |
| Price & barcode label printing | Inventory intelligence: stock value, ABC, days of cover, dead stock, alerts |
| Works on phone, tablet, PC; installable | Import everything from **Loyverse** |

## Technology

- **Frontend:** Vite + vanilla JavaScript (ES modules), one Supabase client, no framework. Built by GitHub Actions and served from GitHub Pages (any static host works). Installable PWA.
- **Backend:** Supabase (PostgreSQL, Auth, Row-Level Security, Storage). Every money or stock change is a single database transaction in a PostgreSQL function — the browser never writes sales, stock or journals directly.
- **Optional:** Google Apps Script for e-mailed alerts/receipts (`google-apps-script/`), Edge Function for staff invitations (`supabase/functions/invite-staff`).

```
src/
  main.js            boot, sign-in, app shell
  router.js          #/home, #/sell, … with role-based access
  lib/               supabase client, formatting, UI kit, receipts, periods
  views/             home, sell, products, customers, buy, count, reports,
                     accounts, inventory, import (Loyverse), staff, settings, setup
  import/loyverse.js Loyverse CSV parsers (unit-tested)
supabase/migrations/ database, in order
supabase/functions/  invite-staff edge function
tests/               parser unit tests + browser smoke test
public/config.json   which Supabase project this copy uses
```

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Loyverse parser tests
npm run build      # production build in dist/
```

`public/config.json` points the app at a Supabase project:

```json
{ "supabaseUrl": "https://YOUR-PROJECT.supabase.co", "supabaseKey": "sb_publishable_..." }
```

Only the **publishable/anon** key goes there. The app refuses to start with a secret key.

## Set up a new shop

See **[SETUP.md](SETUP.md)** — about 15 minutes: create a Supabase project, run the migrations, deploy, sign in, and the first person becomes the owner. Then **[LOYVERSE_MIGRATION.md](LOYVERSE_MIGRATION.md)** to bring over products, stock, customers and sales history.

## Accounting model (summary)

| Event | Debit | Credit |
|---|---|---|
| Sale (cash / mobile money / card / bank / credit) | 1000 / 1010 / 1010 / 1020 / 1100 | 4000 Sales (gross); discount → Dr 4900 |
| Cost of the sale | 5000 COGS | 1200 Inventory |
| Refund | exact reversal of the sale's journal; stock returned | |
| Goods received | 1200 Inventory | 2000 Accounts payable |
| Supplier paid | 2000 Accounts payable | cash/bank account |
| Customer pays credit | cash/bank account | 1100 Receivables |
| Expense | 6000 Operating expenses | cash/bank account |
| Opening stock (incl. Loyverse import) | 1200 Inventory | 3200 Opening balance equity |
| Stock count surplus / shortage | 1200 / 6100 | 4100 / 1200 |
| Stock adjustment gain / loss (damaged, expired, found…) | 1200 / 6100 | 4100 / 1200 |
| Return to supplier | 2000 (credit) or cash/bank (refund) | 1200 Inventory |

Every journal is checked to balance before it is saved. Tax is disabled until a tax policy is configured. Stock is valued at the latest purchase cost.

## Security

- Row-Level Security on every table; writes to money and stock tables only through `SECURITY DEFINER` functions that check the caller's role.
- Managers can edit catalogue details but **cannot type a stock quantity** — stock changes only via sales, receiving, refunds, opening stock and counts.
- Roles: owner, manager, accountant, cashier (see Staff screen).
- Everything sensitive is written to `audit_log`.

## Project history

The original single-shop design notes are kept in `docs/` (`TARGET-ARCHITECTURE.md`, `TRANSACTION-DESIGN.md`). See also **[AI_START_HERE.md](AI_START_HERE.md)**.

---

## 🤝 AI HANDOVER — read this first (written for ChatGPT Go or any new AI assistant)

*Last updated: 27 Oct 2026. Owner: Brian Odoch Emmanuel (GitHub `odoema`). Previous assistant: Claude.*

### 1. Where things are

| Item | Value |
|---|---|
| Live app | https://odoema.github.io/dream-city-grocery/ |
| Repo | https://github.com/odoema/dream-city-grocery (branch `main`; every push to `main` auto-deploys via `.github/workflows/pages.yml`) |
| Supabase project | `nohdgmylncjtdymfshfy` (owned by Supabase account **brianodochemmanuel@gmail.com**) |
| Frontend config | `public/config.json` (URL + **publishable** key only) |
| Tests | `npm test` (parsers) · `npm run test:db` (PGlite database flows) · `npm run build && npm run test:smoke` (Playwright, mocked API) |

**Do NOT touch** the Supabase project `gbyvlotgjrtrnogtbemi` (SmartAttend — a different product). Never put a `service_role`/secret key in browser code, the repo, or chat.

### 2. Current state (all deployed and live)

- Vite + vanilla JS app (no framework). Hash router, role-based nav: owner, manager, accountant, cashier.
- Screens: Home, Sell (till), Products (with photos), Customers (credit + statements), Buy (purchases, supplier bills, orders, suppliers), **Inventory** (overview/intelligence, adjust stock, history, valuation, supplier returns, barcode labels), Count stock, Reports (incl. sales by item/category), Accounts (P&L, balance sheet, trial balance, journals, expenses), Import (Loyverse items/customers/sales), Staff, Settings (white-label branding).
- **All 14 migrations in `supabase/migrations/` are applied to the live database.** Run `scripts/check-migrations.sql` in the Supabase SQL editor to verify (every row should be `true`).
- Data: ~389 products imported from Loyverse. On 26 Oct 2026, empty fields were filled with **estimates** so the shop could be tested:
  - 121 cost prices (selling price × the category's usual cost/price ratio, default 75%)
  - 3 selling prices
  - 38 reorder levels
  - opening stock for 386 products (note "Estimated opening stock") — total ≈ UGX 10.58M at cost
  - **A real stock count (Count stock screen) is still needed** to replace the estimates.
- Known data issues: "Skala Carrot 200g" price 40,002 (probably 4,000); "Pair of Scissors" price 1,000 < cost 1,460.

### 3. Rules of the codebase (keep these)

1. **All money/stock writes go through PostgreSQL `SECURITY DEFINER` functions** (`set search_path = ''`, first line calls `public.require_staff(array[...roles])`). The browser never inserts into sales, journals, inventory_movements or stock directly. `products.quantity_on_hand` is not client-updatable.
2. **Every journal must balance** — call `public.assert_journal_balanced(journal_id)` before returning. Use `public.account_id('code')` and `public.payment_account_code(method)`.
3. **Migrations are additive and idempotent** (`create … if not exists`, `create or replace`, `drop policy if exists`). New file = new timestamp, e.g. `20261028000100_xxx.sql`. Add a row for it in `scripts/check-migrations.sql`. Add tests to `tests/db/flows.mjs`.
4. White-label: never hard-code "Dream City" in new code — read `state.settings` (`store_settings` table).
5. UI helpers live in `src/lib/` (`h()`, `table()`, `card()`, `stat()`, `tabs()`, `formModal()`, `withBusy()`, `money()`, `num()`). New screen = file in `src/views/`, add to `views` in `src/router.js` and `NAV` in `src/main.js`.
6. Friendly errors: database `raise exception 'Plain-English message'` is shown to the user as-is.

### 4. How the owner deploys (he is not a developer)

- **Code:** edit files on GitHub (web editor → "Commit directly to main") or GitHub Desktop → push. GitHub Actions builds and publishes in about 1 minute (Actions tab must show green).
- **Database:** give him the full SQL file; he opens Supabase (brianodochemmanuel@gmail.com) → project → **SQL Editor → New query → paste → Run** and expects "Success. No rows returned". Always give **step-by-step instructions**.

### 5. Gap analysis & roadmap (agreed priorities)

| # | Gap | Why it matters |
|---|---|---|
| 1 | **End-of-shift cash count** (expected vs counted cash per cashier, Z-report) | #1 cash-loss control in groceries |
| 2 | **Manual journals**, owner capital/drawings, loans, cash ↔ bank transfers | Accounts can't be complete without them |
| 3 | **Partial refunds** (single line items) | Only whole-sale refunds today |
| 4 | **Weighted-average stock costing** + **period close/lock** | Today COGS uses latest cost (IAS 2 wants FIFO/weighted average); past months can still change |
| 5 | **VAT + URA EFRIS** e-invoicing | Required for VAT-registered shops in Uganda; tax is deliberately blocked now |
| 6 | Owner trend dashboard, cash-flow statement, expense accounts per category, AR/AP ageing | Owner insight |
| 7 | Bank/mobile-money reconciliation, fixed assets & depreciation | Audit readiness |
| 8 | Multi-shop SaaS: one-click setup script → shared multi-tenant version → branches & stock transfers; rename leftover `dream_city_*` DB objects | Selling to other shops |
| 9 | Offline sales queue, MTN/Airtel mobile-money payments, WhatsApp/SMS receipts, Loyverse API image import (edge function; token must never go in chat) | Nice-to-have |

Minimum before charging another shop: items **1, 2 and 3**. Item **5** decides whether larger (VAT-registered) shops can use it.

### 6. Suggested first prompt for the next AI

> "Read README.md (AI HANDOVER section) and AI_START_HERE.md in odoema/dream-city-grocery. Then build roadmap item #1 (end-of-shift cash count): one new idempotent migration with SECURITY DEFINER functions + balanced journals for cash over/short, a new screen, tests, and step-by-step deploy instructions for a non-developer."
