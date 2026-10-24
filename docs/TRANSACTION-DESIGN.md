# Transaction design

A completed sale must be one atomic server-side business transaction.

## Sale workflow
1. Authenticate cashier and verify role.
2. Lock/check product rows so stock cannot be oversold concurrently.
3. Validate quantities, prices and totals server-side.
4. Create the sale and sale lines.
5. Create inventory movement rows and decrement stock.
6. Create balanced accounting journal entries.
7. Create a notification-outbox event containing the receipt payload.
8. Commit the database transaction.
9. A trusted worker sends the committed receipt payload to Google Apps Script.

## Accounting for a cash sale

Revenue:

- Debit Cash on Hand = sale total
- Credit Sales Revenue = sale total

Inventory/COGS:

- Debit Cost of Goods Sold = cost of sold inventory
- Credit Inventory = cost of sold inventory

The sum of journal debits must equal the sum of journal credits for every posted entry.

## Reliability

Email/PDF delivery is deliberately outside the database transaction. If Google Apps Script is unavailable, the sale remains posted and the notification stays in `notification_outbox` for retry. Retries must be idempotent by receipt number/event ID so one sale cannot create duplicate financial records.
