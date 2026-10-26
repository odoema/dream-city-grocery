# Grocery POS — white-label point of sale, stock and accounts

A complete, mobile-friendly system for a grocery or small shop: **sell, buy, count stock, track customers' credit, and see real profit** — with proper double-entry accounting underneath. It started as Dream City Grocery's system and is now built so **any shop can run its own copy** with its own name, logo, currency and database.

Live (Dream City): https://odoema.github.io/dream-city-grocery/

| For staff | For owners |
|---|---|
| Fast till with barcode scanning, weighed items, cash change | Today's sales, profit and cash at a glance |
| Customer credit and repayments | Profit & loss, balance sheet, trial balance |
| Record purchases in one form | Smart shopping list from real sales |
| Guided stock counts | Refunds, discounts and price changes are controlled and audited |
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
                     accounts, import (Loyverse), staff, settings, setup
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

Every journal is checked to balance before it is saved. Tax is disabled until a tax policy is configured. Stock is valued at the latest purchase cost.

## Security

- Row-Level Security on every table; writes to money and stock tables only through `SECURITY DEFINER` functions that check the caller's role.
- Managers can edit catalogue details but **cannot type a stock quantity** — stock changes only via sales, receiving, refunds, opening stock and counts.
- Roles: owner, manager, accountant, cashier (see Staff screen).
- Everything sensitive is written to `audit_log`.

## Project history

The original single-shop design notes are kept in `docs/` (`TARGET-ARCHITECTURE.md`, `TRANSACTION-DESIGN.md`). For AI/developer hand-over read **[AI_START_HERE.md](AI_START_HERE.md)**.
