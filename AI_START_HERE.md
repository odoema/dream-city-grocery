# AI / developer hand-over — start here

Last updated: **26 October 2026** (v2 white-label rebuild).

## What this is
A white-label grocery POS (sales, stock, purchasing, customers' credit, double-entry accounts) on Supabase. The first deployment is **Dream City Grocery** (Nebbi, Uganda); any other shop can run its own copy with its own Supabase project (see `SETUP.md`).

- GitHub: `odoema/dream-city-grocery` (branch `main` deploys to GitHub Pages via `.github/workflows/pages.yml`).
- Dream City database: Supabase project **`nohdgmylncjtdymfshfy`**. Configured in `public/config.json` (publishable key only).
- **Never** run Dream City SQL against the SmartAttend project (`gbyvlotgjrtrnogtbemi`). `supabase/legacy/` holds the old temporary `dreamcity`-schema files — do not run them.

## Architecture (v2)
- Vite + vanilla JS ES modules in `src/`; a single Supabase client (`src/lib/supabase.js`); hash router with role checks (`src/router.js`); views in `src/views/`.
- All money/stock writes go through PostgreSQL functions (RPCs). Key ones: `complete_sale`, `refund_sale`, `record_shop_purchase`, `receive_supplier_invoice`, `pay_supplier_invoice`, `receive_customer_payment`, `record_expense`, `post_opening_stock`, stocktake functions, `get_sales_summary`, `get_financial_statements`, Loyverse imports (`import_loyverse_items`, `import_customers`, `import_legacy_sales`).
- White-label settings: `store_settings` table (one row) + `get_public_store_profile()` for the login page; first user claims ownership via `claim_first_owner()`.

## What changed in v2 (why)
The v1 site could not sign anyone in: `supabase-config.js` used `document.write` with an escaped closing tag that swallowed `app.js`, the anon key was truncated, and `app.js` referenced ~20 element IDs that no longer existed (it would crash on load). Nine overlay scripts patched each other (prompt() hijacking, DOM scraping, four Supabase clients). v2 replaces all of it.

Database fixes in `20261026000100_white_label_platform.sql`: stock column locked against direct writes; 100%-discount sales balanced; credit limits now net of customer payments; audit spam from every sale removed; any cashier could queue notification e-mails (revoked); sold-by-weight/untracked items; refunds, expenses, customer payments; server-side reports. Earlier migration files fixed: stocktake `$`-quoting (the file could never have run), broken duplicate product-intelligence file removed, duplicate version renumbered.

## Testing
- `npm test` — Loyverse parser unit tests.
- `npm run test:db` — applies every migration to an in-memory Postgres (PGlite) with Supabase stand-ins and runs the business flows as real API roles: sales, replay, refunds, credit limits, purchases, stocktake, imports, reports, staff. Every journal must balance and the balance sheet must balance. Runs in CI.
- `npm run test:smoke` — builds, then drives every screen in Chromium against a mocked API (needs Playwright installed globally).

## Deploying to Dream City's live database
1. Run `scripts/check-migrations.sql` in the SQL editor of `nohdgmylncjtdymfshfy` (read-only).
2. Apply only the files showing `false`, in order. `20261026000100_white_label_platform.sql` is required by v2.
3. Merge to `main`; Pages redeploys. Sign in as the owner and check Settings.

## Known limitations / next steps
- Stock valued at latest purchase cost (not weighted average).
- No offline sales queue (sales require a connection; cart survives in the tab).
- Tax disabled until a tax policy is chosen.
- Cash-advance accountability (issue → spend → return) from `docs/TARGET-ARCHITECTURE.md` not yet built.
- Partial refunds not supported (whole-sale refunds only).
