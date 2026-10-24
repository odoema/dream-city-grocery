# Dream City Grocery — Management Alerts Setup

The repository now contains a management notification queue and Google Apps Script email worker.

## Recipients

- odoema@gmail.com
- bettyudongo@gmail.com

## Alerts covered

- Every completed sale / transaction
- Stock-taking started
- Stock-taking completed or cancelled
- Supplier invoice received
- Supplier payment recorded
- Daily sales summary at 21:30 Africa/Kampala

## 1. Apply the database migration

Apply this migration to the dedicated Dream City Supabase project `nohdgmylncjtdymfshfy`:

`supabase/migrations/20261024000500_management_alerts.sql`

It creates `management_notifications` and server-side triggers. The table has RLS enabled and is intentionally not exposed to ordinary staff clients.

## 2. Configure Google Apps Script

Open the Google Apps Script project used by Dream City Grocery and use the repository's `google-apps-script/Code.gs`.

In **Project Settings → Script Properties**, set:

- `SUPABASE_URL` = `https://nohdgmylncjtdymfshfy.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = the dedicated Dream City Supabase service-role key
- `MANAGEMENT_ALERT_EMAILS` = `odoema@gmail.com,bettyudongo@gmail.com`
- `ALERT_TIMEZONE` = `Africa/Kampala`

The service-role key must exist only in Apps Script properties. Never paste it into `app.js`, `supabase-config.js`, GitHub, or any browser-visible file.

Existing receipt properties remain supported:

- `RECEIPT_WEBHOOK_TOKEN`
- `RECEIPT_EMAIL_TO`
- `DRIVE_RECEIPTS_FOLDER_ID` (optional)

## 3. Install the scheduled workers

In Apps Script, run **`setupManagementAlertTriggers()`** once and authorize the requested Gmail/URL-fetch permissions.

It creates:

- a worker every 5 minutes for queued major-activity alerts
- a daily sales summary around 21:30 Uganda time

## 4. Test safely

Do not create a fake sale merely to test production accounting.

For the alert pipeline, first insert a harmless test notification through the authenticated SQL editor if required, then run `processManagementNotificationQueue()` manually and confirm both recipients receive the email.

After that, verify a real training transaction produces one management alert and that the daily summary reports the day's completed sales.

## Security

The browser never receives the Supabase service-role key. The database creates notifications server-side, while Google Apps Script reads the queue with the service-role key and sends email to the two management recipients.
