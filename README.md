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
- **Documents:** one shared document engine in `src/lib/documents.js` plus the specialist thermal receipt engine in `src/lib/receipt.js`. All printable output follows `docs/BRAND.md`.
- **Optional:** Google Apps Script for e-mailed alerts/receipts (`google-apps-script/`), Edge Function for staff invitations (`supabase/functions/invite-staff`).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Loyverse parser tests
npm run test:db    # database/business-flow tests
npm run build      # production build in dist/
npm run test:smoke # browser smoke test
```

`public/config.json` points the app at a Supabase project. Only the **publishable/anon** key belongs there; the app refuses to start with a secret key.

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
| Stock adjustment gain / loss | 1200 / 6100 | 4100 / 1200 |
| Return to supplier | 2000 (credit) or cash/bank (refund) | 1200 Inventory |

Every journal is checked to balance before it is saved. Tax is disabled until a tax policy is configured. Stock is valued at the latest purchase cost.

## Security

- Row-Level Security on every table; writes to money and stock tables only through `SECURITY DEFINER` functions that check the caller's role.
- Managers can edit catalogue details but **cannot type a stock quantity** — stock changes only via sales, receiving, refunds, opening stock and counts.
- Roles: owner, manager, accountant, cashier.
- Everything sensitive is written to `audit_log`.

## Brand and document standard

The product has a **single visual language for the application and every system-generated document**. The mandatory rulebook is **[docs/BRAND.md](docs/BRAND.md)**.

It covers sales/refund receipts, customer payment receipts, customer statements, purchase orders, goods received notes, supplier return notes, stock adjustment notes, stock count sheets, expense/payment vouchers, financial statements, and price/barcode labels.

New printable output must use `documentHtml()` / `printDocument()` or the thermal receipt engine. Do not create one-off document CSS, colours, logos, typography or footer styles inside individual screens.

## Project history

The original single-shop design notes are kept in `docs/` (`TARGET-ARCHITECTURE.md`, `TRANSACTION-DESIGN.md`). See also **[AI_START_HERE.md](AI_START_HERE.md)**.

---

## 🤝 AI HANDOVER — read this first

*Last updated: 26 Oct 2026. Owner: Brian Odoch Emmanuel (GitHub `odoema`). Previous assistant: Claude.*

### 1. Where things are

| Item | Value |
|---|---|
| Live app | https://odoema.github.io/dream-city-grocery/ |
| Repo | https://github.com/odoema/dream-city-grocery (`main`; every push auto-deploys via `.github/workflows/pages.yml`) |
| Production Supabase | `nohdgmylncjtdymfshfy` |
| Frontend config | `public/config.json` — URL + **publishable** key only |
| Tests | `npm test` · `npm run test:db` · `npm run build && npm run test:smoke` |
| Brand code | `docs/BRAND.md` — mandatory for screens, receipts, documents and labels |
| Document engine | `src/lib/documents.js` — shared A4 document system |
| Receipt engine | `src/lib/receipt.js` — thermal/A4 sales and refund receipts |

**Do NOT touch** Supabase project `gbyvlotgjrtrnogtbemi` (SmartAttend). Never put a `service_role`/secret key in browser code, the repo, or chat.

### 2. Current state

- Vite + vanilla JS app, hash router, role-based nav: owner, manager, accountant, cashier.
- Screens: Home, Sell, Products, Customers, Buy, Inventory, Count stock, Reports, Accounts, Import, Staff, Settings and Setup.
- **All 14 migrations are applied to the live database.** Run `scripts/check-migrations.sql` in the Supabase SQL editor to verify.
- About 389 products were imported from Loyverse. On 26 Oct 2026, missing cost prices, selling prices, reorder levels and opening stock were filled with clearly labelled estimates for testing. A real stock count is still required to replace the opening-stock estimates.
- Known data issues: `Skala Carrot 200g` price 40,002 (probably 4,000); `Pair of Scissors` price 1,000 < cost 1,460.
- Printable output is being standardized around one brand system so the POS, receipts and business documents look like one professional product.

### 3. Rules of the codebase (keep these)

1. **All money/stock writes go through PostgreSQL `SECURITY DEFINER` functions**. The browser never inserts into sales, journals, inventory movements or stock directly.
2. **Every journal must balance** — call `public.assert_journal_balanced(journal_id)` before returning. Use `public.account_id('code')` and `public.payment_account_code(method)`.
3. **Migrations are additive and idempotent.** New file = new timestamp; add it to `scripts/check-migrations.sql` and add tests to `tests/db/flows.mjs`.
4. White-label: never hard-code "Dream City" in new code — read `state.settings` / `store_settings`.
5. UI helpers live in `src/lib/`. New screens belong in `src/views/` and must be registered in the router/nav.
6. Friendly errors: database `raise exception 'Plain-English message'` is shown to the user as-is.
7. **Documents:** use the shared document engine. Do not add document-specific colours, logos, typography or page layouts in a view. Update `docs/BRAND.md` first if a new document requirement is needed.

### 4. How the owner deploys

- **Code:** edit files on GitHub or use GitHub Desktop and push to `main`. GitHub Actions builds and publishes in about 1 minute; the Actions tab must be green.
- **Database:** provide the full SQL file; open the production Supabase project → **SQL Editor → New query → paste → Run**. Always give step-by-step instructions for a non-developer.

### 5. Gap analysis & roadmap

| # | Gap | Why it matters |
|---|---|---|
| 1 | **End-of-shift cash count** (expected vs counted cash per cashier, Z-report) | #1 cash-loss control |
| 2 | **Manual journals**, owner capital/drawings, loans, cash ↔ bank transfers | Complete accounting |
| 3 | **Partial refunds** | Better customer service and control |
| 4 | **Weighted-average stock costing** + **period close/lock** | Stronger inventory accounting |
| 5 | **VAT + URA EFRIS** e-invoicing | Needed for VAT-registered shops |
| 6 | Owner trend dashboard, cash-flow statement, expense categories, AR/AP ageing | Better management insight |
| 7 | Bank/mobile-money reconciliation, fixed assets & depreciation | Audit readiness |
| 8 | Multi-shop SaaS, branches and stock transfers | Commercialization |
| 9 | Offline sales queue, MTN/Airtel payments, WhatsApp/SMS receipts, Loyverse API image import | Nice-to-have |

Minimum before charging another shop: items **1, 2 and 3**. Item **5** decides whether larger VAT-registered shops can use it.

### 6. Current document/brand work

The presentation layer is intentionally centralized: improve the shared receipt/document engines first, then make individual screens call them. This prevents different-looking receipts, statements, vouchers and reports from developing over time.

### 7. Suggested next prompt for a new AI

> "Read README.md, AI_START_HERE.md and docs/BRAND.md in odoema/dream-city-grocery. Preserve the production Supabase architecture. Build roadmap item #1 using the existing security and accounting patterns, and keep all printed output on the shared brand/document system."

## Daily controls (added 28 Oct 2026)

Migration `supabase/migrations/20261028000100_daily_controls.sql` (run once in the SQL editor) adds:

| Feature | Where in the app | Database |
| --- | --- | --- |
| Close day (cash-up per person, shortage/surplus posted to 6200) and a day report for managers (print, copy, WhatsApp) | **Close day** | `cash_ups`, `get_cash_up_preview()`, `close_cash_up()` |
| Return some or all items of a sale | **Reports → Receipt archive → Return** | `sale_returns`, `return_sale_items()`; `refund_sale()` now returns everything left |
| Owner capital in, drawings out, transfers (cash ↔ mobile money ↔ bank) | **Accounts → Owner money** | `money_movements`, `record_money_movement()`, account 3300 |
| Weighted-average buying price when stock is received | automatic | `receive_supplier_invoice()` |
| One-file backup download + daily reminder on the Dashboard | **Settings → Backup & data** | reads tables under the owner's RLS |
| Offline banner; instant Dashboard (realtime on `sales`) | everywhere | publication `supabase_realtime` |

The menu is shorter: Home merged into Dashboard (cashiers land on Sell), **Import** moved to Settings, **Count stock** opened from Inventory. Old links still work.

CI now runs the browser click-through test (`npm run test:smoke`) before every deploy, in addition to the unit and database tests. Source maps are no longer published.
