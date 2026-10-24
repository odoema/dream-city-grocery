# Dream City Grocery

> **Dream City — Empowering Communities**
>
> Grocery Point of Sale, inventory, accounting, reporting and remote-management platform.

## 1. Project purpose

Dream City Grocery is being built as a complete grocery-shop management system rather than a simple cash register. The goal is to give the owner a reliable view of every sale, stock movement, expense and financial result while giving cashiers a simple POS experience.

The system is designed for UGX transactions and is intended to work from a phone, tablet or computer, with an installable mobile/PWA experience planned.

## 2. Important separation from SmartAttend

**Dream City Grocery is a separate business system and has nothing to do with SmartAttend.**

During development, a temporary PostgreSQL schema named `dreamcity` was created inside the existing SmartAttend Supabase project. This was a deliberate temporary arrangement so development could continue while a dedicated Supabase project was being prepared.

- SmartAttend's existing tables and application must remain untouched.
- All Dream City database objects created during this temporary phase belong under the `dreamcity` schema.
- The temporary schema is **not the intended permanent production location**.
- The dedicated Dream City Supabase project created by the user has project reference `nohdgmylncjtdymfshfy`.
- When access to that dedicated project is available, the `dreamcity` schema and its data should be migrated there.
- Do not migrate, modify, rename or delete SmartAttend data as part of the Dream City migration.

## 3. GitHub repository

Repository: `odoema/dream-city-grocery`

Default branch: `main`

This repository is the source of truth for the Dream City Grocery application code, database migrations/schema definitions, Google Apps Script automation and project documentation.

## 4. Target architecture

```text
                    DREAM CITY GROCERY
                            |
             +--------------+--------------+
             |                             |
        Web / PWA POS                 Owner Dashboard
        Phone / Tablet / PC           Remote Management
             |                             |
             +--------------+--------------+
                            |
                         Supabase
                      PostgreSQL/Auth
                            |
       +--------------------+--------------------+
       |                    |                    |
    Inventory           Accounting             Sales
       |                    |                    |
       +--------------------+--------------------+
                            |
                   Google Apps Script
                            |
             +--------------+--------------+
             |              |              |
            PDF           Gmail          Drive
          receipts        alerts         archive
```

### Current temporary backend

The development backend currently uses the `dreamcity` schema inside the SmartAttend Supabase project `gbyvlotgjrtrnogtbemi`.

### Intended permanent backend

The user-created dedicated Dream City Grocery Supabase project is:

`nohdgmylncjtdymfshfy`

The application should ultimately use this project exclusively for Dream City data.

## 5. Core modules

### POS

- Product search
- SKU/barcode support
- Cart
- Quantity and price handling
- Discounts
- Tax field
- Cash, mobile money, card, bank and credit payment methods
- Unique receipt numbers
- Completed/voided/refunded sale states
- Cashier identification

### Product catalogue

Products are designed to store:

- SKU
- Barcode
- Product name
- Category
- Supplier
- Buying price
- Selling price
- Quantity on hand
- Reorder level
- Unit of measure
- Expiry date
- Active/inactive state

### Inventory

Inventory is transaction-based rather than relying only on a current stock number.

Supported movement concepts include:

- Opening stock
- Purchases
- Sales
- Sales returns
- Purchase returns
- Adjustments

Every sale reduces stock and records an inventory movement. Low-stock reporting is based on quantity versus reorder level.

### Suppliers and purchasing

The system is intended to support suppliers, purchasing, receiving stock and supplier payables. Purchase workflows will eventually create both inventory movements and accounting entries.

### Customers

Customers can have contact information, credit limits and sales history. Credit sales are represented through Accounts Receivable rather than being treated as immediate cash receipts.

## 6. Double-entry accounting

Accounting is a first-class component of the system.

The initial chart of accounts includes:

| Code | Account | Type |
|---|---|---|
| 1000 | Cash | Asset |
| 1010 | Mobile Money | Asset |
| 1020 | Bank | Asset |
| 1100 | Accounts Receivable | Asset |
| 1200 | Inventory | Asset |
| 2000 | Accounts Payable | Liability |
| 3000 | Owner Capital | Equity |
| 3100 | Retained Earnings | Equity |
| 4000 | Sales Revenue | Revenue |
| 4900 | Sales Returns & Discounts | Contra/adjustment account |
| 5000 | Cost of Goods Sold | Expense |
| 6000 | Operating Expenses | Expense |

A completed cash/mobile-money/card sale is intended to produce both revenue and COGS entries.

Conceptually:

```text
Dr Cash / Mobile Money / Bank       TOTAL
    Cr Sales Revenue                         NET SALES
```

and:

```text
Dr Cost of Goods Sold               COGS
    Cr Inventory                            COGS
```

The exact payment-account mapping and treatment of discounts/tax must remain consistent with the accounting policy implemented in the production database.

## 7. Atomic sale engine

The temporary backend contains the `dreamcity.complete_sale(...)` PostgreSQL function.

The intended checkout sequence is:

```text
Complete Sale
     |
     +--> Authenticate cashier
     |
     +--> Validate products
     |
     +--> Lock product rows
     |
     +--> Check available stock
     |
     +--> Calculate subtotal / discount / tax / total
     |
     +--> Create sale + sale items
     |
     +--> Deduct inventory
     |
     +--> Record inventory movements
     |
     +--> Create accounting journal
     |
     +--> Create journal lines
     |
     +--> Write audit event
     |
     +--> Commit as one database transaction
     |
     +--> Return receipt number and totals
```

This is important: the POS should not independently update sales, stock and accounting in unrelated client-side requests. The database transaction should remain the source of truth.

## 8. Roles and permissions

The planned roles are:

### Owner

Full business visibility and administration.

### Manager

Operational management, inventory, purchasing, reports and approved financial workflows.

### Cashier

POS sales and permitted cashier operations. Cashiers should not be able to silently alter completed transactions, accounting records or system configuration.

### Accountant

Accounting, expenses, journals and financial reporting without unnecessary POS administration privileges.

Row-Level Security and server-side authorization should be retained in the production implementation.

## 9. Audit trail

Important actions should be auditable, including:

- Sales
- Voids/refunds
- Stock adjustments
- Price changes
- Expense entries
- User/account changes
- Accounting adjustments

The audit record should identify the user, action, entity, timestamp and relevant details.

Completed transactions should normally be corrected through controlled reversal/refund workflows rather than being physically deleted.

## 10. Receipts and Google automation

Google Apps Script is intended to provide the Google Workspace automation layer, not the core transactional database.

Planned workflow:

```text
Completed Sale
      |
      v
Google Apps Script
      |
      +--> Generate PDF receipt
      +--> Email receipt/transaction alert
      +--> Archive PDF in Google Drive
      +--> Support scheduled reports
```

The primary notification/receipt email currently specified for the project is:

`odoema@gmail.com`

The final implementation should use secure server-side credentials and should never expose privileged service credentials in the browser.

## 11. Alerts

The system is intended to support:

- Every-transaction notification
- PDF receipt email
- Low-stock alerts
- Large/unusual transaction alerts
- Refund alerts
- Expense alerts
- Daily sales summary
- Daily profit summary
- Weekly reports
- Monthly financial reports

The dashboard should also show live/recent activity so email is not the only monitoring mechanism.

## 12. Dashboard and analytics

The owner dashboard should eventually show:

- Today's sales
- Transaction count
- Gross profit
- Net profit
- Expenses
- Cash
- Mobile money
- Bank/card collections
- Inventory value
- Receivables
- Payables
- Low-stock products
- Best-selling products
- Slow-moving products
- Sales by cashier
- Sales by payment method
- Sales and profit trends

## 13. Financial reports

The planned reporting suite includes:

- Profit & Loss / Income Statement
- Balance Sheet
- Trial Balance
- General Ledger
- Cash Book
- Bank Book
- Sales report
- Purchase report
- Inventory valuation
- Cost of Goods Sold
- Profit by product
- Profit by category
- Expense report
- Accounts Payable
- Accounts Receivable
- Cash-flow reporting

## 14. Mobile and remote management

The application should be mobile-first and eventually installable as a PWA.

The owner should be able to remotely inspect the business from a phone, including sales, stock, profit, expenses and alerts.

An offline-capable POS is planned as a later phase. Offline sales must be designed carefully so that synchronization cannot create duplicate sales, stock corruption or unbalanced accounting entries.

## 15. Branding

The official supplied Dream City branding is used for the project:

**Dream City — Empowering Communities**

The grocery product name is:

**Dream City Grocery**

The supplied Dream City logo should be used consistently across the POS, dashboard, receipts and reports.

## 16. Currency

Primary currency: **UGX (Ugandan Shillings)**.

Amounts should be stored as exact numeric/decimal values in the database rather than floating-point numbers.

## 17. Security principles

- Never put Supabase service-role/secret keys in frontend code.
- Use authenticated access and Row-Level Security.
- Keep privileged operations server-side.
- Validate prices, quantities and totals server-side.
- Use database transactions for financial operations.
- Record audit events for sensitive operations.
- Do not allow clients to directly manufacture accounting journal entries without authorization.
- Do not expose SmartAttend data to Dream City users.
- Keep Dream City migration scripts separate from SmartAttend migrations.

## 18. Migration plan

The temporary `dreamcity` schema is being used to keep development moving while the dedicated Supabase project is inaccessible to the current connected integration.

When the dedicated project is available:

1. Verify the target project `nohdgmylncjtdymfshfy`.
2. Create the Dream City schema/tables/functions there.
3. Export only Dream City schema definitions and data from the temporary backend.
4. Import and validate them in the dedicated project.
5. Update application environment variables to the dedicated project.
6. Verify authentication, POS, inventory, accounting and reports.
7. Verify Google Apps Script integrations.
8. Run reconciliation tests.
9. Only after successful validation, retire/remove the temporary Dream City schema from SmartAttend.

**Never delete or alter SmartAttend data as part of this migration.**

## 19. Development phases

### Phase 1 — Foundation

- Database
- Authentication
- Roles
- Products
- Categories
- Suppliers
- Inventory

### Phase 2 — POS

- Cart
- Product search/barcode scanning
- Payments
- Sales
- Returns/refunds
- Receipt numbers

### Phase 3 — Automation

- PDF receipts
- Email alerts
- Google Drive archive
- Scheduled reports

### Phase 4 — Accounting

- Chart of accounts
- Double-entry journals
- General ledger
- Trial balance
- P&L
- Balance sheet
- Cash flow
- Receivables/payables

### Phase 5 — Management

- Owner dashboard
- Analytics
- Low-stock alerts
- Profit analytics
- Cashier performance
- Remote management

### Phase 6 — Mobile/offline

- Installable PWA
- Offline transaction queue
- Safe synchronization
- Mobile owner dashboard

## 20. Current status / handoff

This repository is a **development prototype and project foundation**, not yet a production-ready grocery ERP.

Already established conceptually/in the temporary backend:

- Dream City Grocery project scope
- GitHub repository
- Supabase/PostgreSQL architecture
- Temporary `dreamcity` schema
- Core database entities
- Initial chart of accounts
- Roles
- RLS direction
- Atomic `complete_sale()` transaction design
- Google Apps Script receipt/notification direction
- Migration plan to dedicated Supabase project

Still required before live shop use:

- Connect the frontend POS to the temporary Supabase backend
- Configure authentication and initial owner account
- Implement live product/inventory management
- Fully test `complete_sale()` against real product data
- Implement purchase/receiving workflows
- Implement returns/refunds safely
- Implement expenses and full accounting workflows
- Build production dashboard/report queries
- Connect PDF receipt generation to completed sales
- Configure Gmail/Drive automation
- Add robust error handling and reconciliation
- Add automated tests
- Validate security/RLS policies
- Migrate to the dedicated Supabase project
- Deploy the production web/PWA application

## 21. Handoff rule

If development is resumed by another developer or AI agent, **read this README first**.

The most important constraints are:

1. This is **Dream City Grocery**, not SmartAttend.
2. SmartAttend must remain untouched.
3. The current `dreamcity` schema is temporary.
4. The permanent Dream City Supabase target is `nohdgmylncjtdymfshfy`.
5. `odoema/dream-city-grocery` is the GitHub source repository.
6. UGX is the primary currency.
7. Double-entry accounting is required.
8. The database, not the browser, is the financial source of truth.
9. Every completed sale must maintain consistency between sales, inventory, COGS, accounting and audit records.
10. Receipts and transaction notifications are intended to be sent to `odoema@gmail.com`.

## 22. Immediate next development task

**Connect the existing POS UI to the temporary `dreamcity` Supabase schema and implement authenticated live checkout using `dreamcity.complete_sale()`.**

Do not add more demo-only checkout logic when the real database transaction is available. The next implementation should make the POS perform a genuine database-backed sale and then build receipt/notification automation around that confirmed transaction.


## 23. Production protection: SmartAttend.live

**Critical production safety rule — SmartAttend.live serves paying clients. Protect its availability and data above all else.**

The temporary Dream City development setup shares a Supabase project with SmartAttend. A separate PostgreSQL schema provides logical separation, but it does **not** provide full infrastructure isolation: database-wide permissions, resource usage, project settings, or an incorrectly scoped SQL statement can still affect SmartAttend.

Until Dream City has been migrated and validated in its own Supabase project:

- **Do not run destructive or broad SQL** in the shared project. Never use database resets, `DROP SCHEMA ... CASCADE`, broad table drops/truncates, or unreviewed migrations.
- **Never modify SmartAttend's `public` schema**, its tables, functions, triggers, policies, extensions, authentication configuration, production settings, or client records as part of Dream City work.
- Scope Dream City database changes explicitly to `dreamcity`; review every statement before execution. Do not assume that a migration is safe merely because its filename mentions Dream City.
- Do not run `supabase/migrations/001_initial_schema.sql` against the shared project without reviewing every statement; older migration files may create or alter objects outside `dreamcity`.
- Read-only inspection is preferred while investigating. A read-only query should inspect the intended schema explicitly and must not expose secrets or personal client data.
- Do not replace `dreamcity.complete_sale(...)` or apply another database migration until the proposed SQL has been reviewed, its scope is confirmed, and a viable backup/recovery path is verified.
- Test financial and permission changes using disposable test data in an isolated environment first. Never test by creating fake sales or changing real stock in a live business database.
- Keep Supabase service-role/secret keys and database passwords out of chat, source code, browser code, commits, logs, and screenshots.
- Do not claim SmartAttend is unaffected based only on a successful GitHub Actions run; application CI does not verify live database isolation or production health.

### Required target before production

The long-term safe architecture is a **dedicated Supabase project for Dream City Grocery**. Use separate credentials, authentication configuration, backups, and deployment settings. The intended project reference is `nohdgmylncjtdymfshfy`.

Do not move, delete, or retire the temporary `dreamcity` schema from the SmartAttend project until the dedicated target is available, the Dream City data has been migrated and reconciled, and the application has been verified against the dedicated target. Any later cleanup must be a separately reviewed operation with a confirmed recovery path; it must not affect SmartAttend's `public` schema or paying clients.

### Current safety gate

At the time of this note, the installed `dreamcity.complete_sale(...)` function is under review. Its replacement is **not approved or applied by this README update**. Tax accounting treatment remains undecided, so a reviewed checkout change must reject non-zero tax until an appropriate tax liability/accounting policy is established. Card receipts are intended to post to Bank account `1020`, and discounts require owner/manager authorization.

**Default decision when uncertain: stop and inspect; do not execute. SmartAttend.live stability takes precedence over Dream City development speed.**
