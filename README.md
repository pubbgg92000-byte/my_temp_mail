# Titan Temp Mail (avmail.online)

A SvelteKit + Supabase + Titan Mail catch-all receiver for private OTP testing. The normal user route is `/quick`; the larger dashboard remains available only to explicitly allowed database users.

Use this only for accounts, domains, and verification flows you own or are authorized to test. Do not use it for spam, fraud, phishing, bulk account creation, or bypassing platform rules.

## Quick start

```bash
npm install
cp .env.example .env
# Fill in Supabase, Titan IMAP, and TEMP_MAIL_DOMAIN values.

# Run supabase/schema.sql once in Supabase SQL Editor.
npm run dev

# In a separate process:
npm run worker
```

Normal users should open `/quick`. `/dashboard` requires `profiles.dashboard_access = true`, `profiles.role = 'dashboard_user'`, `profiles.role = 'admin'`, or `profiles.role = 'main_admin'`. `/admin` requires `profiles.role = 'admin'` or `profiles.role = 'main_admin'`.

## Deploy to Vercel

Production deploys are intentionally manual. After pushing changes to `main`, open the GitHub repository, go to **Actions**, choose **Deploy to Vercel**, and click **Run workflow**. The workflow checks the app, pulls Vercel production settings, builds with Vercel, and deploys `main` to `https://titan-temp-mail.vercel.app/`.

Add this GitHub Actions secret before running the workflow:

```txt
VERCEL_TOKEN
```

Keep runtime environment variables in Vercel Production settings: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TEMP_MAIL_DOMAIN`, and the `TITAN_IMAP_*` values.

## Database setup

Run `supabase/schema.sql` in Supabase SQL Editor. Before applying the unique canonical local-part index to an existing database, check for old duplicate or dot-variant rows:

```sql
select canonical_local_part, count(*)
from public.temp_inboxes
group by 1
having count(*) > 1;

select lower(email_address), count(*)
from public.temp_inboxes
group by 1
having count(*) > 1;
```

If the app shows `Could not find the 'canonical_local_part' column ... in the schema cache`, the web code is newer than the database schema. Run `supabase/schema.sql`, then refresh the Supabase/PostgREST schema cache from the Supabase dashboard or restart your local Supabase stack before trying random/custom mail creation again.

Grant dashboard access only when needed:

```sql
update public.profiles
set dashboard_access = true
where lower(email) = lower('you@example.com');
```

Promote admins only for trusted operators:

```sql
select public.promote_to_admin('you@example.com');
```

Main admin is database-only. Use it only for the trusted owner account:

```sql
update public.profiles
set role = 'main_admin',
    dashboard_access = true
where lower(email) = lower('owner@example.com');
```

## Project layout

```txt
src/routes/quick                 Minimal OTP-only user app
src/routes/dashboard             Hidden dashboard, permission-gated
src/routes/admin                 Admin stats, admin-only
src/routes/api/inbox/*           Authenticated inbox APIs
src/lib/server                   Server-only auth/admin/audit/rate-limit helpers
src/lib/shared                   Inbox validation, OTP parsing, recipient matching
worker/titan-imap-worker.ts      IMAP poller and OTP saver
supabase/schema.sql              RLS, uniqueness, profile permissions
```

## Security review

Safe:
- Supabase service role and Titan IMAP password are server/worker-only and not exposed through frontend env.
- Protected server routes and APIs use `supabase.auth.getUser()` through server helpers.
- Inbox and message APIs scope reads/deletes by verified `user.id`.
- RLS is enabled for `profiles`, `temp_inboxes`, and `received_emails`.
- The app receives mail only; no sending, attachment download, public inbox browsing, or catch-all mailbox exposure is implemented.

Fixed:
- `/quick` is now the normal mini app for creating mail, generating random mail, fetching OTPs, copying only parsed codes, and managing recent mails.
- `/dashboard` is hidden from normal navigation and blocked unless the profile is explicitly allowed.
- `/admin` supports regular admins, while `main_admin` alone can grant access and view all inboxes/latest verification codes.
- Dot local-parts are rejected because some providers ignore dots.
- `canonical_local_part` and lowercased email unique indexes prevent cross-user reuse and dot-variant abuse.
- Custom creation is limited to 5 per user per hour; random creation remains 10 per user per hour; fetch/delete endpoints are rate-limited.
- Message responses do not return raw HTML, raw headers, attachments, or `full_body`; server-side fallback parsing returns only the OTP code.

Still requires manual setup:
- Store `.env` values only as hosting secrets; never commit real `.env`.
- Run the Supabase schema and resolve any old duplicate aliases before hosting.
- Configure Titan Mail catch-all/IMAP credentials and `TEMP_MAIL_DOMAIN`.
- Review Supabase Auth settings, production HTTPS, and deployment logs before launch.
- Replace the in-memory rate limiter with Redis or another shared store before running multiple web instances.

Risks:
- The IMAP worker uses a service role by design; keep it isolated from client bundles and logs.
- `email_processing_logs` can contain debug previews for unmatched mail; keep RLS enabled and restrict database/operator access.
- Existing databases with old dot-containing aliases need manual cleanup before canonical uniqueness can be guaranteed.
