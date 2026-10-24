# Dream City Grocery — AI START HERE

> **Purpose:** This file is the portable handoff for any AI assistant, developer, or future ChatGPT session that needs to continue Dream City Grocery without relying on previous conversation history.

## 1. Project identity

- Project: **Dream City Grocery**
- Brand: **Dream City — Empowering Communities**
- GitHub: `odoema/dream-city-grocery`
- Default branch: `main`
- Live GitHub Pages app: `https://odoema.github.io/dream-city-grocery/`
- Primary currency: UGX
- Owner notification email currently documented by the project: `odoema@gmail.com`

## 2. Non-negotiable safety rule

**Dream City Grocery must remain completely separate from SmartAttend.**

Historical development temporarily used a `dreamcity` schema inside the SmartAttend Supabase project. That is legacy only. Do not run Dream City migrations, resets, destructive SQL, or broad SQL against SmartAttend.

The intended dedicated production Supabase project is:

- Project ref: `nohdgmylncjtdymfshfy`
- URL: `https://nohdgmylncjtdymfshfy.supabase.co`

The current browser configuration points to that dedicated project. Verify the deployed app before real transactions.

## 3. Source-of-truth hierarchy

1. **GitHub** — application code, migrations and durable project documentation.
2. **Dedicated Supabase project** `nohdgmylncjtdymfshfy` — live transactional/database authority.
3. **Google Apps Script / Drive** — planned document, receipt and reporting automation layer.
4. **AI conversation** — working session only; never treat chat history as the only copy of a decision or requirement.

## 4. Current repository structure

Important files/directories currently present:

- `README.md` — technical architecture and safety constraints.
- `USER_GUIDE.md` — operational instructions and warnings.
- `SUPABASE_SETUP.md` — dedicated Supabase setup and smoke-test instructions.
- `supabase-config.js` — browser-safe Supabase URL/public key configuration.
- `app.js` — frontend application logic.
- `index.html` — application shell.
- `styles.css` — application styling.
- `supabase/migrations/` — versioned database changes.
- `google-apps-script/` — Google Workspace automation.
- `docs/` — project documentation.
- `public/` — public web assets.

There is currently no `AGENTS.md`; this file is the primary portable AI handoff.

## 5. Current database migration baseline

The repository contains the dedicated initial schema migration:

`supabase/migrations/20261024000100_initial_schema.sql`

and the purchasing/AP migration documented in `SUPABASE_SETUP.md`:

`supabase/migrations/20261024000200_purchasing_ap.sql`

The initial schema establishes roles, payment methods, accounting types, inventory movement types, profiles and the core business database structure. Review the actual migration files before changing production.

## 6. Current application state

Treat the application as **development/MVP until independently verified**. Existing documentation says the interface has had demo/sample figures and that some long-term modules are not necessarily complete.

The current documented MVP includes, or is intended to include:

- staff authentication/profile checks
- live product reads
- manager product creation
- atomic checkout RPC
- recent sales
- printable receipts
- purchasing/AP workflows in the newer migration/UI

Do not infer production readiness from the presence of a UI control. Verify the database function, authorization, resulting records and reconciliation totals.

## 7. Accounting principles

- Database is the financial source of truth.
- Financial operations should be atomic.
- Sales, inventory, COGS, accounting and audit records must remain consistent.
- Do not manufacture journal entries from the browser to make reports balance.
- Tax is currently disabled/rejected unless the business policy is explicitly established.
- UGX amounts should use exact numeric/decimal storage, not floating-point arithmetic.

## 8. Safe development workflow

Use this order for every significant change:

**Audit → Reconcile → Implement → Test → Review → Approve → Deploy → Verify**

Before changing anything:

1. Read `README.md`.
2. Read `SUPABASE_SETUP.md` for database work.
3. Read the relevant migration and frontend code.
4. Identify the exact target project/ref.
5. Prefer read-only inspection first.
6. Never expose or request passwords, service-role keys, or secrets in chat.
7. Never use SmartAttend as a testing target for Dream City.
8. Test financial workflows with isolated test data.
9. Commit durable decisions/documentation to GitHub.

## 9. Production verification checklist

Before declaring the system ready for live shop use, verify:

- [ ] Live app points to `nohdgmylncjtdymfshfy`.
- [ ] Dedicated database migrations are applied exactly once and reviewed.
- [ ] Auth users and active staff profiles exist.
- [ ] RLS/server-side authorization works for every role.
- [ ] Product reads and creation work according to role.
- [ ] Cash sale succeeds and creates expected sale, inventory, COGS, journal and audit records.
- [ ] Credit sale requires an active customer and respects credit policy.
- [ ] Insufficient stock fails atomically with no partial writes.
- [ ] Invalid discount/tax/duplicate-line conditions fail safely.
- [ ] Purchasing and supplier-payment workflows reconcile correctly.
- [ ] Stocktake cannot post incomplete counts.
- [ ] Reports are based on verified data rather than sample/demo figures.
- [ ] Receipt/Google automation is verified if enabled.
- [ ] Backup and recovery procedures are documented and tested.
- [ ] SmartAttend has not been modified as part of Dream City work.

## 10. If the previous AI/session is unavailable

Do **not** ask the user to reconstruct the whole project from memory.

Start here, inspect GitHub, then inspect the dedicated Supabase project if the required connector/access is available. Report:

1. current branch and latest commit;
2. repository structure;
3. current migration baseline;
4. live Supabase target;
5. what is verified versus merely documented;
6. open risks/blockers;
7. the smallest safe next step.

If an AI system cannot access Supabase, it can still continue code/documentation work from this repository and must clearly mark database state as **unverified**.

## 11. Recovery principle

This project is intentionally designed so that loss of access to one AI does not mean loss of the project. GitHub contains the durable implementation and this handoff. Supabase contains the live data. Google Drive/Apps Script can contain generated business documents. The AI is replaceable; the project record is not.

## 12. Immediate next task

**Audit the deployed application against the dedicated Supabase project, then perform an isolated end-to-end verification of authentication, product loading, checkout, purchasing, stocktake and accounting. Do not use real shop transactions as test data.**

Last handoff baseline: **24 October 2026**.
