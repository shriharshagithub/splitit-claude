-- SplitIt schema. Money is integer paise (bigint). Apps can only SELECT (through row-level security);
-- every change goes through a security definer function in the next migration.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text unique check (phone ~ '^91[6-9][0-9]{9}$'),
  email text,
  upi_id text check (upi_id is null or upi_id ~ '^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$'),
  avatar_url text,
  reminder_freq text not null default 'daily' check (reminder_freq in ('daily', 'weekly', 'off')),
  created_at timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  type text not null check (type in ('trip', 'flat', 'other')),
  created_by uuid not null references public.profiles(id),
  invite_code text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  phone text check (phone ~ '^91[6-9][0-9]{9}$'),
  email text,
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  check ((phone is null) <> (email is null))
);
create index invites_phone_idx on public.invites (phone) where accepted_at is null;
create index invites_email_idx on public.invites (lower(email)) where accepted_at is null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  paid_by uuid not null references public.profiles(id),
  total_amount bigint not null check (total_amount > 0 and total_amount <= 10000000000),
  description text not null check (char_length(btrim(description)) between 1 and 100),
  category text not null default 'general',
  expense_date date not null,
  split_type text not null check (split_type in ('equal', 'exact', 'percentage', 'shares')),
  split_values jsonb not null default '{}'::jsonb,
  receipt_url text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_group_idx on public.expenses (group_id, expense_date desc, created_at desc);

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_owed bigint not null check (amount_owed >= 0),
  unique (expense_id, user_id)
);
create index expense_splits_user_idx on public.expense_splits (user_id);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  item_name text not null,
  item_amount bigint not null check (item_amount >= 0),
  assigned_user_ids uuid[] not null
);
create index receipt_items_expense_idx on public.receipt_items (expense_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  amount bigint not null check (amount > 0),
  method text not null check (method in ('upi', 'cash')),
  status text not null default 'pending' check (status in ('pending', 'marked_paid', 'completed', 'declined')),
  upi_ref text check (upi_ref is null or char_length(upi_ref) <= 40),
  created_at timestamptz not null default now(),
  marked_paid_at timestamptz,
  completed_at timestamptz,
  declined_at timestamptz,
  nudged_at timestamptz,
  check (from_user <> to_user)
);
create index settlements_group_idx on public.settlements (group_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  type text not null check (type in ('payment_request', 'payment_marked', 'payment_confirmed', 'payment_declined',
                                     'reminder', 'expense_added', 'member_added', 'confirm_nudge')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  debtor_user_id uuid not null references public.profiles(id) on delete cascade,
  creditor_user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check (amount > 0),
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  channel text not null default 'email+in_app',
  status text not null default 'sent' check (status in ('scheduled', 'sent', 'failed', 'skipped'))
);
create index reminders_debtor_idx on public.reminders (debtor_user_id, group_id, sent_at desc);

-- Group activity log shown on the Activity screen.
create table public.activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor uuid references public.profiles(id) on delete set null,
  kind text not null,
  summary text not null,
  created_at timestamptz not null default now()
);
create index activity_group_idx on public.activity (group_id, created_at desc);

-- Membership helpers. security definer so RLS policies can call them without recursion.
create function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid());
$$;
create function public.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = gid and user_id = auth.uid() and role = 'admin');
$$;
create function public.shares_group_with(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid = auth.uid() or exists (
    select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = uid);
$$;

-- Row-level security: read-only, scoped to membership.
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.invites enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.receipt_items enable row level security;
alter table public.settlements enable row level security;
alter table public.notifications enable row level security;
alter table public.reminders enable row level security;
alter table public.activity enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (public.shares_group_with(id));
create policy groups_read on public.groups for select to authenticated using (public.is_member(id));
create policy members_read on public.group_members for select to authenticated using (public.is_member(group_id));
create policy invites_read on public.invites for select to authenticated using (public.is_member(group_id));
create policy expenses_read on public.expenses for select to authenticated using (public.is_member(group_id));
create policy splits_read on public.expense_splits for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
create policy items_read on public.receipt_items for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_member(e.group_id)));
create policy settlements_read on public.settlements for select to authenticated using (public.is_member(group_id));
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy reminders_read on public.reminders for select to authenticated
  using (debtor_user_id = auth.uid() or creditor_user_id = auth.uid());
create policy activity_read on public.activity for select to authenticated using (public.is_member(group_id));

-- No direct writes from the app at all.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
-- Invite codes are only visible to admins, through a function.
revoke select on public.groups from authenticated;
grant select (id, name, type, created_by, created_at, updated_at) on public.groups to authenticated;

-- Commit-time check: the splits of every expense must add up to its total.
create function public.check_expense_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  eid uuid := coalesce(new.expense_id, old.expense_id);
  t bigint;
  s bigint;
begin
  if tg_table_name = 'expenses' then eid := coalesce(new.id, old.id); end if;
  select total_amount into t from public.expenses where id = eid;
  if t is null then return null; end if;  -- expense deleted
  select coalesce(sum(amount_owed), 0) into s from public.expense_splits where expense_id = eid;
  if s <> t then
    raise exception 'splits (%) do not add up to the expense total (%)', s, t using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger expense_splits_sum after insert or update or delete on public.expense_splits
  deferrable initially deferred for each row execute function public.check_expense_total();
create constraint trigger expenses_sum after insert or update of total_amount on public.expenses
  deferrable initially deferred for each row execute function public.check_expense_total();
