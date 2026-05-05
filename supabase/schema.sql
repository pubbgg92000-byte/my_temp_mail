create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text default 'user',
  dashboard_access boolean default false,
  created_at timestamptz default now()
);

alter table public.profiles add column if not exists dashboard_access boolean default false;
alter table public.profiles add column if not exists is_blocked boolean default false;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and coalesce(role, 'user') = 'user'
  and coalesce(dashboard_access, false) = false
);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (
  auth.uid() = id
  and coalesce(role, 'user') = 'user'
  and coalesce(dashboard_access, false) = false
);

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table if not exists public.temp_inboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text unique not null,
  local_part text not null,
  canonical_local_part text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  status text default 'active',
  ip_address text,
  user_agent text
);

create index if not exists temp_inboxes_user_id_idx on public.temp_inboxes(user_id);
create index if not exists temp_inboxes_email_address_idx on public.temp_inboxes(email_address);
create index if not exists temp_inboxes_active_idx on public.temp_inboxes(email_address) where status = 'active';

alter table public.temp_inboxes alter column expires_at drop not null;
alter table public.temp_inboxes add column if not exists canonical_local_part text;

update public.temp_inboxes
set canonical_local_part = lower(replace(local_part, '.', ''))
where canonical_local_part is null;

-- If either unique index fails, remove or rename old duplicate/dot-variant rows first:
-- select canonical_local_part, count(*) from public.temp_inboxes group by 1 having count(*) > 1;
-- select lower(email_address), count(*) from public.temp_inboxes group by 1 having count(*) > 1;
create unique index if not exists temp_inboxes_email_address_lower_unique
on public.temp_inboxes(lower(email_address));

create unique index if not exists temp_inboxes_canonical_local_part_unique
on public.temp_inboxes(canonical_local_part);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'temp_inboxes_local_part_safe_check'
  ) then
    alter table public.temp_inboxes
      add constraint temp_inboxes_local_part_safe_check
      check (
        local_part = lower(local_part)
        and local_part = canonical_local_part
        and local_part ~ '^[a-z0-9_+-]{3,32}$'
        and local_part !~ '\.'
      ) not valid;
  end if;
end $$;

alter table public.temp_inboxes enable row level security;

drop policy if exists temp_inboxes_select_own on public.temp_inboxes;
create policy temp_inboxes_select_own on public.temp_inboxes
for select to authenticated using (auth.uid() = user_id);

drop policy if exists temp_inboxes_insert_own on public.temp_inboxes;
create policy temp_inboxes_insert_own on public.temp_inboxes
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists temp_inboxes_delete_own on public.temp_inboxes;
create policy temp_inboxes_delete_own on public.temp_inboxes
for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.received_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  inbox_id uuid not null references public.temp_inboxes(id) on delete cascade,
  recipient_email text not null,
  sender_email text,
  subject text,
  body_preview text,
  full_body text,
  detected_code text,
  message_id text unique,
  received_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists received_emails_user_id_idx on public.received_emails(user_id);
create index if not exists received_emails_inbox_id_idx on public.received_emails(inbox_id);
create index if not exists received_emails_received_at_idx on public.received_emails(received_at desc);
create index if not exists received_emails_created_at_idx on public.received_emails(created_at desc);

alter table public.received_emails enable row level security;

drop policy if exists received_emails_select_own on public.received_emails;
create policy received_emails_select_own on public.received_emails
for select to authenticated using (auth.uid() = user_id);

create table if not exists public.inbox_usage_stats (
  inbox_id uuid primary key references public.temp_inboxes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email_address text not null,
  received_count integer not null default 0,
  otp_count integer not null default 0,
  last_received_at timestamptz,
  last_otp_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists inbox_usage_stats_user_id_idx on public.inbox_usage_stats(user_id);
create index if not exists inbox_usage_stats_email_address_idx on public.inbox_usage_stats(email_address);
alter table public.inbox_usage_stats enable row level security;

drop policy if exists inbox_usage_stats_select_own on public.inbox_usage_stats;
create policy inbox_usage_stats_select_own on public.inbox_usage_stats
for select to authenticated using (auth.uid() = user_id);

insert into public.inbox_usage_stats (
  inbox_id,
  user_id,
  email_address,
  received_count,
  otp_count,
  last_received_at,
  last_otp_at
)
select
  ti.id,
  ti.user_id,
  ti.email_address,
  count(re.id)::int,
  count(re.id) filter (where re.detected_code is not null)::int,
  max(coalesce(re.received_at, re.created_at)),
  max(coalesce(re.received_at, re.created_at)) filter (where re.detected_code is not null)
from public.temp_inboxes ti
left join public.received_emails re on re.inbox_id = ti.id
group by ti.id, ti.user_id, ti.email_address
on conflict (inbox_id) do update
set received_count = greatest(public.inbox_usage_stats.received_count, excluded.received_count),
    otp_count = greatest(public.inbox_usage_stats.otp_count, excluded.otp_count),
    last_received_at = case
      when public.inbox_usage_stats.last_received_at is null then excluded.last_received_at
      when excluded.last_received_at is null then public.inbox_usage_stats.last_received_at
      else greatest(public.inbox_usage_stats.last_received_at, excluded.last_received_at)
    end,
    last_otp_at = case
      when public.inbox_usage_stats.last_otp_at is null then excluded.last_otp_at
      when excluded.last_otp_at is null then public.inbox_usage_stats.last_otp_at
      else greatest(public.inbox_usage_stats.last_otp_at, excluded.last_otp_at)
    end,
    updated_at = now();

create or replace function public.purge_expired_received_emails()
returns integer language plpgsql security definer set search_path = public as $$
declare
  scrubbed_count integer;
begin
  update public.received_emails
  set subject = null,
      body_preview = null,
      full_body = null,
      detected_code = null
  where coalesce(received_at, created_at) < now() - interval '20 minutes'
    and (
      subject is not null
      or body_preview is not null
      or full_body is not null
      or detected_code is not null
    );
  get diagnostics scrubbed_count = row_count;
  return scrubbed_count;
end;
$$;

create table if not exists public.processed_messages (
  id uuid primary key default gen_random_uuid(),
  message_id text unique not null,
  processed_at timestamptz default now(),
  status text,
  error_message text
);
alter table public.processed_messages enable row level security;

create table if not exists public.email_processing_logs (
  id uuid primary key default gen_random_uuid(),
  message_id text,
  from_email text,
  subject text,
  received_at timestamptz,
  all_detected_recipients text[],
  recipient_candidates text[],
  scoped_recipients text[],
  matched_inbox_id uuid references public.temp_inboxes(id) on delete set null,
  matched_email_address text,
  matched_email text,
  matched_method text,
  detected_code text,
  match_status text not null,
  error_message text,
  reason text,
  raw_debug_preview text,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table public.email_processing_logs add column if not exists message_id text;
alter table public.email_processing_logs add column if not exists from_email text;
alter table public.email_processing_logs add column if not exists subject text;
alter table public.email_processing_logs add column if not exists received_at timestamptz;
alter table public.email_processing_logs add column if not exists all_detected_recipients text[];
alter table public.email_processing_logs add column if not exists recipient_candidates text[];
alter table public.email_processing_logs add column if not exists scoped_recipients text[];
alter table public.email_processing_logs add column if not exists matched_inbox_id uuid references public.temp_inboxes(id) on delete set null;
alter table public.email_processing_logs add column if not exists matched_email_address text;
alter table public.email_processing_logs add column if not exists matched_email text;
alter table public.email_processing_logs add column if not exists matched_method text;
alter table public.email_processing_logs add column if not exists detected_code text;
alter table public.email_processing_logs add column if not exists match_status text;
alter table public.email_processing_logs add column if not exists error_message text;
alter table public.email_processing_logs add column if not exists reason text;
alter table public.email_processing_logs add column if not exists raw_debug_preview text;
alter table public.email_processing_logs add column if not exists metadata jsonb;
alter table public.email_processing_logs add column if not exists created_at timestamptz default now();
create index if not exists email_processing_logs_message_id_idx on public.email_processing_logs(message_id);
create index if not exists email_processing_logs_created_at_idx on public.email_processing_logs(created_at desc);
alter table public.email_processing_logs enable row level security;

create table if not exists public.blocked_local_parts (
  id uuid primary key default gen_random_uuid(),
  local_part text unique not null,
  reason text,
  created_at timestamptz default now()
);
alter table public.blocked_local_parts enable row level security;

insert into public.blocked_local_parts (local_part, reason) values
  ('admin','reserved'),('support','reserved'),('billing','reserved'),
  ('root','reserved'),('abuse','reserved'),('postmaster','reserved'),
  ('security','reserved'),('contact','reserved'),('help','reserved'),
  ('sales','reserved'),('info','reserved'),('mail','reserved'),
  ('noreply','reserved'),('no-reply','reserved'),('system','reserved'),
  ('api','reserved'),('www','reserved'),('login','reserved'),
  ('signup','reserved'),('dashboard','reserved'),('privacy','reserved'),
  ('terms','reserved')
on conflict (local_part) do nothing;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz default now()
);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
alter table public.audit_logs enable row level security;

create or replace function public.promote_to_admin(target_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set role = 'admin',
      dashboard_access = true
  where lower(email) = lower(target_email);
end;
$$;

-- Main admins are intentionally database-only. Promote one trusted owner manually:
-- update public.profiles set role = 'main_admin', dashboard_access = true where lower(email) = lower('owner@example.com');
create or replace function public.grant_dashboard_access(target_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
  set role = 'dashboard_user',
      dashboard_access = true
  where lower(email) = lower(target_email);
end;
$$;
