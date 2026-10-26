# Setting up a shop

Each shop gets **its own Supabase project** (its own database, logins and backups) and its own copy of the website. Nothing is shared between shops.

## 1. Create the database (Supabase)

1. Create a free project at https://supabase.com (pick the region closest to the shop).
2. **Authentication → Providers → Email:** keep Email on. **Authentication → Sign In / Providers:** turn **"Allow new users to sign up" OFF** — staff are invited by the owner.
3. **Authentication → URL configuration:** set *Site URL* to the website address (e.g. `https://yourname.github.io/your-shop/`) and add it to *Redirect URLs* (needed for password-reset and invitation e-mails).
4. **SQL Editor:** run every file in `supabase/migrations/` **in filename order**, one at a time. Do not run the files in `supabase/legacy/`.
   - Existing database? First run `scripts/check-migrations.sql` (read-only) and only apply the files it shows as `false`.
5. **Project Settings → API:** copy the **Project URL** and the **publishable key** (`sb_publishable_…`, or the legacy *anon* key). Never use the secret/service-role key in the website.

## 2. Put the website online (GitHub Pages)

1. Fork or copy this repository.
2. Either edit `public/config.json` with the URL and publishable key, **or** add repository *variables* (Settings → Secrets and variables → Actions → Variables) `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` — the build writes `config.json` for you.
3. Settings → Pages → *Source: GitHub Actions*. Push to `main`; the workflow tests, builds and deploys.

Any static host (Netlify, Cloudflare Pages, your own server) also works: run `npm run build` and upload `dist/`.

## 3. First sign-in

1. In Supabase **Authentication → Users → Add user**, create the owner's login (e-mail + password, *auto-confirm*).
2. Open the website and sign in. Because the shop has no owner yet, you are offered **"Make me the owner"**.
3. Fill in the shop details (name, logo, currency, time zone, receipt prefix).
4. Go to **Import data** to bring in Loyverse (see `LOYVERSE_MIGRATION.md`), or add products by hand.

## 4. Add staff

Two options:

- **Simple:** Supabase → Authentication → Users → *Add user* for each person. They appear in **Staff** as cashiers; the owner changes their role there.
- **Invitations from the app:** deploy the edge function once:
  ```bash
  supabase login
  supabase link --project-ref YOUR_PROJECT_REF
  supabase functions deploy invite-staff
  ```
  Then **Staff → Add staff member** sends an invitation e-mail.

## 5. Optional extras

- **E-mail alerts & daily summary:** `ALERTS_SETUP.md` (Google Apps Script; the shop name is read from Settings).
- **Logo:** Settings → Logo (stored in the public `branding` bucket).
- **Receipt printer:** Settings → Printer paper (58 mm, 80 mm or A4). Receipts print through the browser's print dialog.

## Updating an existing shop

1. Run `scripts/check-migrations.sql`, apply any new migration files in order.
2. Merge the new code to `main` — the site redeploys automatically.
