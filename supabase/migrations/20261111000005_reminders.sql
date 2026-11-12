-- Helpers for the scheduled reminder job and the email hook. Callable only by the service role
-- (edge functions); never by app users.

create function public._verify_hook(secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'hook_secret' and decrypted_secret = $1);  -- $1: the view has its own `secret` column
$$;

-- Every member of every group that has an open balance, with what the reminder rules need.
create function public._reminder_inputs() returns table (
  group_id uuid, group_name text, user_id uuid, full_name text, net bigint,
  debt_since timestamptz, frequency public.reminder_frequency, last_reminded timestamptz
) language sql stable security definer set search_path = '' as $$
  select g.id, g.name, n.user_id, p.full_name, n.net, d.since, p.reminder_frequency,
    (select max(r.sent_at) from public.reminders r where r.group_id = g.id and r.debtor_user_id = n.user_id)
  from public.groups g
  cross join lateral public._group_nets(g.id) n
  join public.profiles p on p.id = n.user_id
  left join public.debt_since d on d.group_id = g.id and d.user_id = n.user_id
  where exists (select 1 from public._group_nets(g.id) x where x.net <> 0);
$$;

create function public._send_reminder(g uuid, debtor uuid, creditor uuid, amt bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare gname text;
begin
  select name into gname from public.groups where id = g;
  insert into public.reminders (group_id, debtor_user_id, creditor_user_id, amount, scheduled_at, sent_at, status)
    values (g, debtor, creditor, amt, now(), now(), 'sent');
  perform public._notify(debtor, g, 'reminder', 'Reminder: you owe ' || public._first_name(creditor),
    'You owe ' || public._first_name(creditor) || ' ' || public._inr(amt) || ' for ' || gname || '.',
    jsonb_build_object('creditor', creditor, 'amount', amt));
  perform public._log(g, null, 'reminder_sent',
    'Automatic reminder sent to ' || public._first_name(debtor) || ' for ' || public._inr(amt), amt,
    jsonb_build_object('debtor', debtor, 'creditor', creditor));
end $$;

-- One nudge to the receiver for any claim left unanswered for 3 days.
create function public._nudge_unconfirmed() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0;
begin
  for s in
    select t.*, g.name as gname from public.settlements t join public.groups g on g.id = t.group_id
    where t.status = 'marked_paid' and t.marked_paid_at < now() - interval '3 days' and t.creditor_nudged_at is null
    for update of t
  loop
    perform public._notify(s.to_user, s.group_id, 'confirm_nudge', 'A payment is waiting for you',
      public._first_name(s.from_user) || ' marked ' || public._inr(s.amount) || ' to you as paid for ' || s.gname
        || ' ' || extract(day from now() - s.marked_paid_at)::int || ' days ago. Confirm or decline it in SplitIt.',
      jsonb_build_object('settlement_id', s.id, 'amount', s.amount));
    update public.settlements set creditor_nudged_at = now() where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public._verify_hook(text), public._reminder_inputs(), public._send_reminder(uuid, uuid, uuid, bigint),
  public._nudge_unconfirmed() from public, anon, authenticated;
grant execute on function public._verify_hook(text), public._reminder_inputs(), public._send_reminder(uuid, uuid, uuid, bigint),
  public._nudge_unconfirmed() to service_role;
