# Titan Temp Mail (avmail.online)

A SvelteKit + Supabase + Titan Mail catch-all temp-mail dashboard.
Each user signs up, generates short-lived addresses on your domain, and
receives only the verification codes for the addresses they created — RLS
keeps every user's mail isolated.

## Quick start (macOS / Linux)

```bash
# 1. Install deps (uses npm; switch to yarn/pnpm if you prefer)
npm install

# 2. Copy env template and fill in real values
cp .env.example .env
# Edit .env with: Supabase URL+keys, Titan IMAP password, your domain.

# 3. Load the schema once in Supabase → SQL Editor
#    (paste the entire contents of supabase/schema.sql and click Run)

# 4. Start the web app
npm run dev
# → http://localhost:5173

# 5. In a second terminal, start the IMAP worker
npm run worker
# → [worker] Titan IMAP worker started for domain avmail.online
```

## Promote yourself to admin

After signing up your first user, run in Supabase SQL Editor:

```sql
select public.promote_to_admin('you@example.com');
```

Then visit `/admin` to see system stats.

## End-to-end smoke test

1. Sign up at `/signup`.
2. On the dashboard click **Generate Random Email**.
3. Send a test email from any other account to that address with body
   `Your verification code is 482913`.
4. Within ~7s the worker logs `[worker] saved   uid=…` and the code shows
   up in the dashboard's **Verification Code** card.

## Project layout

```
src/
  hooks.server.ts            Supabase SSR cookie wiring + safeGetSession
  app.css                    Tailwind v4 theme (mint / ink / gold)
  lib/
    server/                  Server-only helpers (admin client, audit, auth, rate-limit)
    shared/                  Reusable: inbox validation, otp extractor, recipient matcher
    supabase/                Browser supabase client
  routes/
    +page.svelte             Landing
    signup/, login/          Email + password auth
    dashboard/               User's inboxes + verification code box
    admin/                   Admin stats (role = admin only)
    api/
      inbox/random           POST  → create random inbox (rate-limited 5/h)
      inbox/custom           POST  → create custom local-part inbox
      inbox/[inboxId]        DELETE
      inbox/[inboxId]/messages  GET (refresh-limited 1/5s)
      inboxes                GET   → list current user's inboxes
      admin/stats            GET   → admin only
worker/
  titan-imap-worker.ts       IMAP poller → recipient match → OTP extract → DB insert
supabase/
  schema.sql                 Idempotent schema with RLS + profile trigger + admin helper
```

## Production deployment

- Web: `npm run build && node build` (adapter-node already configured).
- Worker: a **separate** process running `npm run worker`. Don't share a
  process with the web server — restarts will drop the IMAP connection.
- Set every `.env` value as a secret in your hosting platform.
- Replace the in-memory rate limiter (`src/lib/server/rate-limit.ts`) with a
  Redis-backed version before scaling beyond one instance.

## Security

- All user data is protected by Supabase RLS — `auth.uid()` matched against
  `temp_inboxes.user_id` and `received_emails.user_id`.
- `SUPABASE_SERVICE_ROLE_KEY` and `TITAN_IMAP_PASSWORD` are server-only.
  They are never imported into any file under `src/lib/supabase/` or any
  `+page.svelte`. If you add new routes, keep service-role usage to
  `src/lib/server/admin.ts` and the worker.
- No outgoing email. No attachment download. By design, MVP scope.
