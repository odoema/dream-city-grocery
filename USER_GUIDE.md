# Dream City Grocery — User Guide

**Brand:** Dream City — Empowering Communities  
**Currency:** UGX (Ugandan Shillings)  
**Application:** https://odoema.github.io/dream-city-grocery/  
**Source code:** https://github.com/odoema/dream-city-grocery

> **Important: confirm the live-data status before using this guide for real shop operations.** The current interface includes prototype/sample dashboard figures and a demo-mode indicator. Do not treat sample figures as actual sales or stock. Use transaction functions only after the owner confirms the app is connected to the intended Dream City Supabase project and real data has been verified.

## Contents

1. Getting started and signing in
2. Dashboard
3. Point of Sale (POS)
4. Inventory and products
5. Stock taking and reconciliation
6. Purchases, goods receiving and supplier payments
7. Accounting
8. Reports
9. Staff roles and access
10. Common problems
11. Daily operating checklist

## 1. Getting started and signing in

1. Open the application link above on a computer, tablet or phone.
2. Sign in using your authorized staff email and password.
3. If you forget your password, select **Forgot password?**, enter your staff email and use the email link to choose a new password.
4. If the account is not active or has no Dream City staff profile, ask the owner/administrator to configure it.
5. On a phone, use the bottom navigation; on a computer, use the side navigation.
6. Use **Sign out** when finished on a shared device.

The application requires an active staff profile. A successful email/password login alone is not enough if the corresponding staff profile is missing or inactive.

## 2. Dashboard

The Dashboard is the management overview. It is designed to show sales, profit, transaction activity and low-stock warnings, with shortcuts to a new sale, inventory and reports.

- **Today's sales / transaction count:** review activity for the day.
- **Profit:** use as an indicator only after the figures are connected to verified accounting data.
- **Low-stock items:** follow up by checking Inventory and arranging a purchase where appropriate.
- **Sales overview and recent transactions:** review trends and transaction details.

**Prototype warning:** if the dashboard says figures are sample data or shows illustrative activity, those figures are not real. Do not use them for cash reconciliation, profit reporting or business decisions.

## 3. Point of Sale (POS)

Use POS to record a customer sale.

### Make a sale

1. Open **Point of Sale**.
2. Search for the product by name or SKU, or select it from the product list.
3. Add each item to the cart.
4. Review quantities and prices carefully. Remove mistakes or adjust quantities before checkout.
5. Select the payment method: **Cash**, **Mobile Money**, **Card**, **Bank**, or **Credit**, where enabled.
6. For a credit sale, select the customer. A credit sale should not proceed without a customer.
7. An owner or manager may be prompted to authorize/enter a discount. Enter zero when there is no approved discount. Do not invent a discount to force a sale through.
8. Review the cart total and complete checkout once the customer has paid or the approved credit arrangement is confirmed.
9. Keep the receipt number for queries and reconciliation. Print the receipt if the receipt action is available.

### POS controls and rules

- Use the actual quantity sold; do not add a product twice to work around a quantity control.
- Confirm the price before checkout. Any price override should be approved under shop policy.
- The checkout workflow is designed to submit the sale through a database transaction so that sale details, stock movements and accounting remain consistent.
- Avoid clicking checkout repeatedly while it is processing.
- If checkout reports an error, do not assume the sale succeeded. Check the transaction list/receipt status before trying again, to avoid duplicate records.
- Returns, refunds and voids must follow an authorized reversal process. Do not delete a completed sale manually.
- Tax is currently sent as zero by the UI. Do not add tax manually until the owner has confirmed the applicable tax and accounting setup.

## 4. Inventory and products

Open **Inventory** to search and review the product catalogue.

The inventory table displays product code/SKU, name, category, buying cost, selling price, stock on hand, reorder level and stock status.

### Add a product

Where your role allows it:

1. Choose **Add product**.
2. Enter a clear product name and unique SKU/product code.
3. Enter buying cost and selling price in UGX.
4. Enter the opening quantity and reorder level.
5. Optionally enter a category. If a new category name is supplied, the app may create it.
6. Save, then verify the product appears with the correct values.

Only an owner or manager can add products in the current UI. Avoid creating duplicate SKUs or products with slightly different spellings.

### Monitor stock

- Search by product name, SKU or category.
- Compare **Stock on hand** with the **Reorder level**.
- Low-stock status means stock is at or below the configured reorder threshold.
- Use Purchases to record replenishment through the proper goods-receiving workflow.
- Do not change stock just to make it agree with a shelf count. Use Stock Taking so the difference is documented.

## 5. Stock taking and reconciliation

Stock taking compares the quantity physically present in the shop with the system quantity. The stocktake screen is designed to capture a full count, show variances, and—after approval—post stock adjustments and related accounting entries.

**Roles:** owner, manager or accountant.  
**Critical principle:** count what is physically present, not what you expect to be present.

### Before starting

1. **Record all new goods first.** If Dorcas or another supplier has delivered goods, complete the applicable Purchases / goods-receiving entry before starting the count. Do not count delivered goods as if they were missing from the system.
2. Finish recording known sales and receipts that occurred before the count.
3. Arrange a short pause on sales and receiving while the stock snapshot and physical count are taken. If the shop cannot pause, agree a controlled cut-off with the person supervising the count.
4. Prepare a physical count sheet or use the item list on the Stock Taking screen.
5. Organize shelves and storage areas so each product is counted once. Include shop floor, store room and any other approved stock location.

### Start a stocktake session

1. Open **Stock Taking**.
2. Check that there is no active draft session that should be continued.
3. Select **Start stocktake**.
4. Confirm the prompt that new supplier goods have been recorded and that sales/receiving can pause during the count.
5. Add a useful note, such as `Physical count — 24 Oct 2026`, then confirm.
6. The system takes a stock snapshot and creates a draft session with a session number and product list.

Do not start the snapshot before entering Dorcas's new purchases. Otherwise the system quantity may be lower than the actual stock because the delivery has not yet been recorded.

### Count each product

For every listed product:

1. Find the matching product by its name and SKU. Verify the pack size/unit.
2. Physically count all sellable stock in all included locations.
3. Enter the **actual physical quantity** in the counted-quantity field.
4. Count damaged, expired, held or unsellable goods according to the shop's agreed policy. Record those separately and do not silently include them as saleable stock.
5. If no units are present, enter **0**. A zero is a completed count; leaving the field blank means it has not been counted.
6. Search and work through the entire list, including products with zero stock.
7. Recount any surprising result before saving/approval.

The screen tracks how many products have been counted and how many differ from the system. It will not allow finalization while any product remains uncounted.

### Understand stock variance

**Variance = physical counted quantity − system quantity**

- Positive variance: more units physically present than the system expected (surplus).
- Negative variance: fewer units physically present than the system expected (shortage).
- Zero variance: the count matches the system.

Example: system quantity 18, physical count 15 → variance = 15 − 18 = **−3 units**. Record 15, not 18. The system's reconciliation process should calculate the adjustment.

Review every non-zero variance. Check SKU, pack size, duplicate counting, unrecorded deliveries, sales during the count, damaged stock and data-entry mistakes. Correct the cause in the appropriate workflow before approval if possible.

### Review and approve

1. Confirm that the counted-products total equals the total products in the session.
2. Review all variances and recount any unusual differences.
3. Ensure sales and receiving remained paused for the agreed count window, or that the supervisor has reconciled activity during that period.
4. Select **Approve & post adjustments** only when the count is complete and reviewed.
5. Read the confirmation. Approval updates product stock, creates inventory movements and posts accounting entries for stock variances. The UI warns that this cannot be undone through POS.
6. Confirm the success message and review the displayed surplus/shortage values.
7. Check Inventory and Accounting afterward; reload if needed. Keep the session number and count notes for the shop records.

**Approval is a consequential action.** Do not approve a count with blanks, guessed numbers or unexplained large variances. If a posted count is wrong, stop and ask the owner/accountant to use a reviewed correction process; do not start changing database balances manually.

### Cancel and restart a draft

- **Cancel stocktake** cancels the current draft and, according to the app confirmation, does not change stock or accounting balances.
- Use it only when the draft snapshot is wrong, the count needs a fresh start, or the supervisor has decided not to proceed.
- After canceling, correct the underlying records first (for example, enter the supplier delivery), then start a new session.
- The screen keeps stocktake history, so cancellation is not the same as erasing the history.
- Do not cancel a completed/posted session expecting it to reverse the posted adjustment.

### Stocktake checklist

- [ ] All supplier deliveries, including Dorcas's new goods, recorded in Purchases
- [ ] Sales/receiving paused or cut-off controlled
- [ ] Correct stocktake session number noted
- [ ] Every product physically counted
- [ ] Zero-stock items explicitly entered as 0
- [ ] Units/pack sizes verified
- [ ] Variances recounted and investigated
- [ ] Counted total matches total listed products
- [ ] Authorized person approves the final count
- [ ] Inventory and accounting reviewed after posting

## 6. Purchases, receiving and supplier payments

Open **Purchases**. This module is restricted to owner, manager and accountant roles in the current UI.

### Add/manage suppliers

Use the supplier controls to create or select the supplier from whom goods are bought. Keep supplier names consistent and maintain accurate contact information.

### Create a purchase order

1. Select **Create purchase order**.
2. Choose the supplier.
3. Enter each product and ordered quantity/cost using the format requested by the dialog.
4. Optionally enter expected delivery date and notes.
5. Confirm and record the generated purchase-order number.
6. Track the order status and items ordered/received.

A purchase order records what you intend to buy; it is not proof that the goods arrived.

### Receive goods and record a supplier invoice

1. Choose **Receive goods / record supplier invoice**.
2. Select the correct supplier.
3. Enter the supplier's invoice number and invoice date.
4. Enter the due date if there is one.
5. Enter the products actually received, with quantities and unit costs.
6. If the delivery relates to an existing order, link the matching purchase-order number when prompted.
7. Add delivery notes if useful and confirm.
8. Verify the goods-receipt number, invoice total and updated stock/purchase records.

Record only what was actually delivered. If the supplier delivered fewer units than ordered, record the actual received quantity and follow up on the outstanding quantity. Do not create a receipt just to record an order that has not arrived.

### Pay a supplier invoice

1. Find the invoice and choose **Record payment**.
2. Enter a payment reference (cash voucher, bank reference or mobile-money transaction reference).
3. Choose the correct payment method: cash, mobile money, card or bank.
4. Enter the amount paid. It must be greater than zero and no more than the outstanding balance.
5. Confirm and verify the remaining balance.

For partial payments, record the amount actually paid. Never mark an invoice paid merely because payment is planned. Keep the supplier invoice and proof of payment.

## 7. Accounting

Open **Accounting**. The current UI loads journals, journal lines, active accounts, completed sales and supplier invoices to present financial summaries and accounting activity. Owner, manager and accountant roles have access in the current implementation.

Core accounting concepts:

- **Revenue:** value earned from sales.
- **Cost of Goods Sold (COGS):** cost of the goods sold.
- **Inventory:** value of stock held.
- **Accounts Payable:** amounts still owed to suppliers.
- **Accounts Receivable:** amounts customers owe from credit sales.
- **Expenses:** operating costs such as rent, transport or utilities.
- **Journal:** dated accounting entry; journal lines should balance in total debits and credits.

Stocktake adjustments may create accounting entries for surplus/shortage. Supplier receiving and payment workflows also affect stock, payables and cash/bank balances through database functions.

Use Accounting to review activity and investigate discrepancies. Do not edit or manufacture journal entries simply to make a report match a target. For a posted transaction error, document the issue and ask the owner/accountant to use a controlled correction or reversal.

**Accounting caveat:** the exact tax treatment, final production reporting, and any accounting controls must be confirmed before the system is used as the official books of record. Dashboard sample values are not accounting evidence.

## 8. Reports

Open **Reports** to review transaction/reporting information made available by the current implementation. The intended reporting scope includes sales, inventory, purchases, profit, expenses and financial performance.

- Choose a date period where the screen provides a period filter.
- Check the date range and currency before interpreting totals.
- Compare report totals against POS receipts, payment-provider/bank statements, supplier invoices and accounting journals.
- Treat a report as unavailable rather than inventing a figure if data has not loaded.
- Do not use sample/demo values as actual financial results.

Not every report in the long-term reporting plan is necessarily implemented in the current prototype. The current screen and live verified data determine what is available.

## 9. Staff roles and access

Current application checks include:

| Role | Current UI access (subject to database permissions) |
|---|---|
| Owner | POS; add products/customers; approve discounts; inventory, stocktaking, purchases, accounting and reports |
| Manager | Similar operational access to owner for the features currently checked in the UI; follow owner policy for discounts and adjustments |
| Accountant | Stocktaking, purchases and accounting/reporting workflows; not allowed to add products or customers through the current UI |
| Cashier | Intended for permitted POS operations; stocktaking and purchasing are restricted |

Database Row-Level Security and server-side authorization remain the final authority. If an action is denied, do not try to bypass the role check; ask the owner to review the staff profile and permissions.

## 10. Common problems

**I can sign in but the modules do not open**
- Confirm the staff profile is active.
- Refresh the page and sign in again.
- On desktop, use the sidebar; on mobile, use the bottom navigation.
- If the problem persists, report the device, browser, role and exact error message to the administrator.

**The app says it cannot load data**
- Check internet access.
- Ask the administrator to confirm the dedicated Dream City Supabase configuration and database migrations.
- Do not enter duplicate transactions as a workaround.

**A product or supplier is missing**
- Search by SKU/name carefully.
- Ask an authorized owner/manager to add the missing product or supplier before recording the transaction.
- For a missing delivered product, do not approve a stocktake using guessed quantities.

**Stocktake shows an unexpected shortage/surplus**
- Recount the item and verify unit/pack size.
- Confirm all supplier goods and sales up to the cut-off have been recorded.
- Review possible duplicates, damage, expiry, or unrecorded stock movements.
- Do not approve until material differences are understood.

**A payment or checkout failed**
- Read the error message and verify whether the transaction exists before retrying.
- Keep receipt, invoice and payment reference details.
- Escalate repeated errors; do not manually edit balances.

## 11. Daily operating checklist

### Opening
- Sign in with your own staff account.
- Check dashboard warnings and low-stock products.
- Verify that products and prices needed for the day are available.

### During the day
- Record every sale through POS.
- Record delivered supplier goods through Purchases before counting or selling them as available stock.
- Keep invoices, receipts and payment references.
- Report unexpected stock or transaction errors promptly.

### Closing
- Reconcile cash, mobile money, card and bank collections against recorded sales and payment statements.
- Review sales and any approved expenses using verified data.
- Follow up low-stock items and unpaid supplier balances.
- Conduct stocktake when scheduled, with deliveries entered and movement cut-off controlled.
- Sign out on shared devices.

---

## System and safety notes

- Application repository: `odoema/dream-city-grocery`
- Intended dedicated Supabase project reference: `nohdgmylncjtdymfshfy`
- Currency: UGX
- Dream City Grocery is separate from SmartAttend. Do not change SmartAttend tables, credentials, configuration or production data as part of grocery operations.
- Never put a Supabase service-role/secret key in browser code or commit it to GitHub.
- Do not run unreviewed SQL or destructive migrations against a shared project.
- Keep the current README and database migration notes as the technical source of truth for deployment status.

For technical setup, architecture, database boundaries and deployment handoff, see [README.md](README.md).
