create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text default 'user',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated with check (auth.uid() = id);

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

alter table public.received_emails enable row level security;

drop policy if exists received_emails_select_own on public.received_emails;
create policy received_emails_select_own on public.received_emails
for select to authenticated using (auth.uid() = user_id);

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
  ('noreply','reserved'),('no-reply','reserved')
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
  update public.profiles set role = 'admin' where lower(email) = lower(target_email);
end;
$$;
