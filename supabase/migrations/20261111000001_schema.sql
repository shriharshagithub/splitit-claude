-- SplitIt schema. All money is bigint paise.
create extension if not exists pgcrypto with schema extensions;

create type public.group_type as enum ('trip', 'flat', 'other');
create type public.member_role as enum ('admin', 'member');
create type public.split_type as enum ('equal', 'exact', 'percentage', 'shares');
create type public.settlement_method as enum ('upi', 'cash');
create type public.settlement_status as enum ('pending', 'marked_paid', 'completed', 'declined');
create type public.notification_type as enum (
  'payment_request', 'payment_marked', 'payment_confirmed', 'payment_declined',
  'reminder', 'expense_added', 'member_added', 'confirm_nudge'
);
create type public.reminder_frequency as enum ('daily', 'weekly', 'off');

-- "users" in the PRD. Linked 1:1 to auth.users.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 80),
  phone text unique check (phone ~ '^\+91[6-9][0-9]{9}$'),
  email text unique check (email = lower(email)),
  upi_id text check (upi_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$'),
  avatar_url text,
  reminder_frequency public.reminder_frequency not null default 'daily',
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  type public.group_type not null default 'other',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

-- People added by phone or email who are not on SplitIt yet.
create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  contact text not null,
  contact_kind text not null check (contact_kind in ('phone', 'email')),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  accepted_by uuid references public.profiles (id),
  accepted_at timestamptz
);
create unique index group_invites_open on public.group_invites (group_id, contact) where accepted_at is null;
create index on public.group_invites (contact) where accepted_at is null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  paid_by uuid not null references public.profiles (id),
  total_amount bigint not null check (total_amount > 0 and total_amount <= 10000000000),
  description text not null check (char_length(btrim(description)) between 1 and 120),
  category text not null default 'general'
    check (category in ('food', 'travel', 'stay', 'groceries', 'rent', 'utilities', 'entertainment', 'shopping', 'general')),
  expense_date date not null default current_date,
  split_type public.split_type not null,
  split_inputs jsonb not null default '[]',
  receipt_url text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_feed on public.expenses (group_id, expense_date desc, created_at desc, id desc);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  amount_owed bigint not null check (amount_owed > 0),
  unique (expense_id, user_id)
);
create index on public.expense_splits (user_id);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  item_name text not null check (char_length(item_name) between 1 and 120),
  item_amount bigint not null check (item_amount >= 0),
  assigned_user_ids uuid[] not null check (cardinality(assigned_user_ids) > 0)
);
create index on public.receipt_items (expense_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount bigint not null check (amount > 0),
  method public.settlement_method not null,
  status public.settlement_status not null default 'pending',
  upi_ref text check (upi_ref ~ '^[0-9A-Za-z]{6,35}$'),
  created_at timestamptz not null default now(),
  marked_paid_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  creditor_nudged_at timestamptz,
  check (from_user <> to_user)
);
create index on public.settlements (group_id, status);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  debtor_user_id uuid not null references public.profiles (id),
  creditor_user_id uuid not null references public.profiles (id),
  amount bigint not null check (amount > 0),
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  channel text not null default 'email+in_app',
  status text not null default 'sent' check (status in ('scheduled', 'sent', 'failed'))
);
create index on public.reminders (debtor_user_id, group_id, sent_at desc);

-- Group activity log shown on the Activity screen.
create table public.activity (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  kind text not null,
  summary text not null,
  amount bigint,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.activity (group_id, created_at desc);

-- When each member's balance in a group last went negative (drives the 3-day reminder rule).
create table public.debt_since (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  since timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Row level security: every table on, reads scoped to group membership,
-- all writes except a few own-row updates go through checked functions.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.receipt_items enable row level security;
alter table public.settlements enable row level security;
alter table public.notifications enable row level security;
alter table public.reminders enable row level security;
alter table public.activity enable row level security;
alter table public.debt_since enable row level security;

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
grant update (full_name, upi_id, avatar_url, reminder_frequency) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

create function public.is_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid());
$$;

create function public.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = g and m.user_id = auth.uid() and m.role = 'admin');
$$;

create function public.shares_group_with(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create policy "own or co-member profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_group_with(id));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members read group" on public.groups for select to authenticated using (public.is_member(id));
create policy "members read members" on public.group_members for select to authenticated using (public.is_member(group_id));
create policy "members read invites" on public.group_invites for select to authenticated using (public.is_member(group_id));
create policy "members read expenses" on public.expenses for select to authenticated using (public.is_member(group_id));
create policy "members read splits" on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
create policy "members read receipt items" on public.receipt_items for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
create policy "members read settlements" on public.settlements for select to authenticated using (public.is_member(group_id));
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members read reminders" on public.reminders for select to authenticated using (public.is_member(group_id));
create policy "members read activity" on public.activity for select to authenticated using (public.is_member(group_id));
-- debt_since: no policies, server only.

-- Storage: private receipts (written only by the scan-bill function), public avatars.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png']),
       ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "members read receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
