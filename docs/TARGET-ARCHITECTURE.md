# Dream City Grocery — Target Operating Model & Implementation Plan

**Status:** Approved working architecture for the next implementation phase  
**Date:** 2026-10-25  
**Repository:** `odoema/dream-city-grocery`

## 1. Purpose

Dream City Grocery should make the real shop workflow extremely simple while keeping strong financial, stock, audit and management controls underneath.

The real operating workflow is:

```text
Money issued
    ↓
System-generated shopping recommendation
    ↓
Worker reviews list
    ↓
Worker buys goods from shops/suppliers in Nebbi
    ↓
Receipts/evidence captured
    ↓
Goods return to Dream City
    ↓
Goods received into stock
    ↓
Goods placed on shelf
    ↓
Sales consume stock
    ↓
Stock taking verifies physical stock
    ↓
Variances are reviewed and posted
    ↓
Accounting + audit + management intelligence
```

The software should describe the business in simple language to workers. Complex accounting and control concepts should remain behind the scenes.

## 2. Core design principle

> **The worker records what happened. The system performs the complicated accounting, control and analysis.**

The application must not force ordinary shop workers to understand purchase orders, journal entries, inventory valuation or accounts payable terminology unless they are performing an advanced/management workflow.

## 3. Target technology architecture

```text
                         DREAM CITY GROCERY
                                  |
              +-------------------+-------------------+
              |                                       |
        SIMPLE STAFF APP                         MANAGEMENT
        Phone / tablet / PC                       Dashboard + email
              |                                       |
              +-------------------+-------------------+
                                  |
                              Supabase
                         PostgreSQL + Auth
                                  |
       +------------------+-------+-------+------------------+
       |                  |               |                  |
     Sales            Purchasing       Inventory         Accounting
       |                  |               |                  |
       +------------------+-------+-------+------------------+
                                  |
                          Control & Evidence
                                  |
                 +----------------+----------------+
                 |                |                |
              Documents        Audit           Exceptions
                 |                |                |
                 +----------------+----------------+
                                  |
                           Intelligence Layer
                                  |
          Demand • Reorder • Supplier • Margin • Loss • Cash
                                  |
                         Google Apps Script
                                  |
                       Gmail + Google Drive
```

### Technology decisions

- **Keep Supabase/PostgreSQL** as the financial and operational source of truth.
- **Keep Supabase Auth and RLS.**
- **Keep server-side RPCs** for atomic financial and inventory operations.
- **Keep the existing inventory movement and double-entry accounting model.**
- **Keep Google Apps Script** for email/PDF/Drive automation rather than putting privileged credentials in the browser.
- **Keep GitHub Pages** for the web frontend.
- Use the existing HTML/CSS/JavaScript frontend for now; do not introduce a major frontend rewrite merely to implement this direction.
- Add analytical calculations in PostgreSQL/views/RPCs where they depend on authoritative transaction data. Use JavaScript only for presentation and user interaction.

## 4. Staff experience

### Main actions

The staff-facing navigation should prioritize:

1. **Sell**
2. **Buy**
3. **Stock**
4. **Count stock**
5. **Customers**

Management/accounting functions can remain available according to role.

### Dorcas purchasing workflow

```text
BUY
 ↓
Today's suggested shopping list
 ↓
Review quantities
 ↓
Confirm shopping trip
 ↓
Record actual purchases
 ↓
Capture receipt/evidence
 ↓
Receive goods
 ↓
Done
```

A purchase order is optional and should not block the ordinary shop workflow.

### Stock-taking workflow

```text
COUNT STOCK
 ↓
Start count
 ↓
Enter physical quantities
 ↓
Review differences
 ↓
Finish & post
```

The existing database stocktake controls should remain authoritative.

## 5. Shopping intelligence

The system should generate a suggested shopping list from actual performance rather than a fixed low-stock number alone.

### Minimum inputs

For each active product, calculate or retain:

- current quantity on hand
- historical units sold
- sales days/frequency
- average daily units sold
- recent 7/14/30-day sales velocity
- reorder level/minimum stock
- desired stock-cover days
- supplier lead time where known
- safety-stock setting
- pack/carton size where known
- recent purchase cost
- recent supplier prices
- stock currently incoming
- recent stocktake variance

### Initial formula

Use a transparent, explainable formula first. Do not begin with an opaque machine-learning model.

```text
Adjusted Daily Demand
    = weighted recent sales velocity

Target Stock
    = Adjusted Daily Demand × Desired Cover Days
      + Safety Stock

Recommended Purchase
    = Target Stock
      - Current Stock
      - Confirmed Incoming Stock
```

Clamp negative recommendations to zero and round upward to the configured purchase/pack size when applicable.

### Recommendation explanation

Every recommendation should be explainable to a worker/manager, for example:

> **Sugar 1kg — buy 12**  
> Selling about 4/day • 8 left • about 2 days of stock remaining • target 5 days.

### Human override

The worker can change a recommended quantity, but the system should preserve:

- system recommendation
- actual quantity selected
- user
- timestamp
- reason where material

The system recommends; the human decides.

## 6. Management shopping email

The Executive Director should receive the suggested shopping list separately from ordinary transaction alerts.

### Recommended email contents

- date
- estimated shopping budget
- urgent items
- recommended items
- product, current stock, demand, recommended quantity and estimated cost
- material manual changes from system recommendation
- unusual purchase-price observations
- important stock warnings
- link to the management view/document where available

The email should not require Dr. Betty to approve every ordinary purchase unless an explicit approval threshold is configured.

## 7. Cash accountability

The system must eventually support a first-class cash-advance workflow.

```text
Cash issued
    ↓
Shopping expenditure
    ↓
Receipts/evidence
    ↓
Goods received
    ↓
Cash returned
    ↓
Reconciliation
```

The reconciliation must show:

```text
Cash issued
- Supported purchases
- Other approved expenditure
- Cash returned
= Unaccounted difference
```

A non-zero unexplained difference should create a management exception according to configured thresholds.

## 8. Evidence and documents

Every material transaction should have an automatically generated, uniquely numbered document or voucher.

Examples:

- Sale → Sales Receipt
- Purchase → Purchase Record/Receipt
- Goods received → Goods Received Record
- Supplier payment → Payment Voucher
- Cash advance → Cash Advance Voucher
- Cash return → Cash Return/Reconciliation Record
- Stock adjustment → Stock Adjustment Record
- Refund → Refund Record

Documents must be:

- automatically numbered
- linked to the authoritative transaction
- retrievable by number/date/person/supplier/type
- printable
- downloadable as PDF where appropriate
- securely archived
- immutable after posting except through controlled reversal/correction

Google Drive may remain the document archive, but the database must remain the authoritative index and transaction source.

## 9. Audit and anti-loss controls

The system must preserve a complete event trail for sensitive activity.

At minimum capture:

- who
- what
- when
- affected record
- before/after values where relevant
- reason for material override
- supporting evidence reference

Important exception types include:

- purchase quantity materially above recommendation
- purchase price materially above historical/supplier price
- unsupported purchase amount
- cash advance not reconciled
- missing receipt for material expenditure
- unusual stock adjustment
- repeated stock loss
- large refund/void
- manual price override
- unusual supplier selection

Alerts should identify exceptions without making unverified accusations of dishonesty.

## 10. Analytics-ready data model

Operational records must remain structured and relational so that analysis can be performed without scraping UI text or PDF documents.

Every material business event should connect to:

```text
Transaction
  → Document
  → Evidence
  → Stock movement
  → Accounting entry
  → Audit event
  → Analytics dimensions
```

Useful analytical dimensions include:

- date/time
- product
- category
- supplier/shop
- worker/user
- transaction type
- payment method
- location where relevant
- quantity
- unit cost
- selling price
- gross margin
- stock movement
- exception type

Do not duplicate financial truth merely to make a dashboard. Prefer database views/materialized views or controlled reporting queries over authoritative tables.

## 11. Management intelligence

The target dashboard should eventually answer:

### Sales

- What sold today?
- What is growing?
- What is declining?
- What are the strongest days/times?

### Stock

- What will run out soon?
- What is overstocked?
- What is not moving?
- Where are stock losses occurring?

### Purchasing

- What should we buy today?
- How much should we buy?
- What did we actually buy?
- At what price?
- Which suppliers are consistently cheaper?

### Profitability

- What products make the most gross profit?
- Which products have weak margins?
- How are purchase-price changes affecting profit?

### Accountability

- How much money was issued for shopping?
- How much was supported by receipts?
- How much was returned?
- What remains unexplained?
- Which exceptions need management attention?

## 12. Gap matrix from Phase 1 audit

| Capability | Current state | Target state | Priority |
|---|---|---|---|
| Sales/POS | Strong backend foundation | Preserve + validate | High |
| Inventory movements | Strong | Preserve | High |
| Stocktake | Strong database controls | Simplify UI + validate | High |
| Purchasing | Formal PO/invoice/receipt model | Simple shop workflow over same controls | **Critical** |
| Shopping recommendation | Basic reorder/low-stock concepts | Performance-based recommendation engine | **Critical** |
| Cash advance accountability | Not first-class | Advance → spend → return → reconcile | **Critical** |
| Receipt/document generation | Partially implemented | Universal document centre | High |
| Secure evidence archive | Google Drive infrastructure exists | Transaction-linked evidence | High |
| Audit trail | Exists | Expand to overrides/exceptions/evidence | High |
| Management alerts | Queue + Apps Script exists | Add shopping intelligence + critical exceptions | High |
| Executive shopping email | Missing as intelligence workflow | Daily/triggered recommended list | **Critical** |
| Analytics-ready structure | Transactional foundation exists | Standard analytical dimensions/views | High |
| Business intelligence | Basic reports/dashboard | Demand, supplier, margin, loss and cash insights | High |
| Advanced PO workflow | Exists conceptually | Keep as optional management workflow | Medium |
| Mobile/PWA | Responsive web | Improve after core workflow | Medium |
| Offline POS | Not implemented | Later phase | Low |

## 13. Implementation sequence

### Milestone 1 — Smart Purchasing Foundation

1. Inspect current purchase RPCs/tables in detail.
2. Design the shopping recommendation data model.
3. Create read-only analytical calculations first.
4. Validate recommendations against historical sales.
5. Add a simple suggested shopping list UI.
6. Keep the existing purchase/receive RPCs as the financial source of truth.
7. Record recommendation vs actual quantity.

### Milestone 2 — Evidence and Documents

1. Define universal document numbering.
2. Link documents to transactions.
3. Complete PDF generation.
4. Complete secure Drive archiving.
5. Build searchable document retrieval.

### Milestone 3 — Cash Accountability

1. Cash advance.
2. Purchase expenditure allocation.
3. Receipt/evidence capture.
4. Cash return.
5. Reconciliation.
6. Exception generation.

### Milestone 4 — Management Alerts

1. Shopping-list email to Executive Director.
2. Price anomalies.
3. Quantity anomalies.
4. Cash differences.
5. Stock-loss alerts.
6. Large adjustment/refund alerts.

### Milestone 5 — Intelligence Dashboard

1. Demand velocity.
2. Stock cover.
3. Reorder recommendations.
4. Supplier comparison.
5. Margin analysis.
6. Dead stock.
7. Stock variance.
8. Cash accountability.

### Milestone 6 — Final UX simplification

Replace temporary prompt-interception helpers with direct, maintainable UI flows. The worker should never have to interact with the underlying accounting workflow.

## 14. Safety rules

- Do not replace the existing financial source of truth with client-side calculations.
- Do not allow recommendation logic to directly alter stock.
- A recommendation is not a purchase.
- A planned purchase does not increase stock.
- Only an authorized goods-receiving transaction increases stock.
- Never silently overwrite posted transactions.
- Do not delete posted financial history to correct mistakes; use controlled reversal/correction workflows.
- Do not expose service-role credentials in frontend code.
- Do not modify SmartAttend or its production data.
- Do not run broad/destructive database migrations without reviewing the exact SQL and target project.

## 15. Definition of success

A successful implementation will allow Dorcas to do her normal job with minimal training:

> **Open Buy → see what the system recommends → adjust if necessary → go shopping → record what she actually bought → capture receipts → bring goods back → receive goods → stock updates automatically.**

At the same time, management can answer:

> **What did we recommend? What was bought? What did it cost? Where is the receipt? What happened to the money? What entered stock? What sold? What is missing? What needs attention?**

That is the target Dream City Grocery architecture.
