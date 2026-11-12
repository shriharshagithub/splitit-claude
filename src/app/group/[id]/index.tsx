import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { formatDate, formatINR, simplifyDebts } from '@/core';
import { Avatar, Button, Card, Empty, ErrorBox, InfoBox, Loading, NetText, Screen, Segmented, T } from '@/components/ui';
import { keys, useExpenses, useGroupInfo, useNets, usePendingExpenses, useRpc, useSettlements } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useLiveGroups } from '@/lib/realtime';
import { MIN_TOUCH, space, useColors } from '@/lib/theme';
import { categoryOf, type Expense, type Member } from '@/lib/types';

export default function GroupDetail() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const c = useColors();
  const me = useUserId();
  const [tab, setTab] = useState<'expenses' | 'balances'>(initialTab === 'balances' ? 'balances' : 'expenses');
  const info = useGroupInfo(id);
  const nets = useNets(id);
  useLiveGroups([id]);
  const names = useMemo(() => Object.fromEntries((info.data?.members ?? []).map((m) => [m.user_id, m.profile.full_name])), [info.data]);
  const name = (uid: string) => (uid === me ? 'You' : names[uid] ?? 'Former member');

  if (!info.data) {
    return <Screen title="Group">{info.error ? <ErrorBox message={friendlyError(info.error)} onRetry={() => info.refetch()} /> : <Loading />}</Screen>;
  }
  const myNet = nets.data?.[me] ?? 0;
  return (
    <Screen scroll={false} title={info.data.name}
      right={<Pressable accessibilityRole="button" accessibilityLabel="Group settings and members" onPress={() => router.push(`/group/${id}/edit`)}
        style={{ minWidth: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}><T v="h2">⚙︎</T></Pressable>}
      footer={
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button title="+ Add expense" style={{ flex: 1 }} onPress={() => router.push(`/group/${id}/expense`)} />
          <Button title="Scan bill" variant="secondary" onPress={() => router.push(`/group/${id}/scan`)} />
        </View>
      }>
      <Card style={{ backgroundColor: c.surface2, paddingVertical: space(3) }}>
        <T v="small">{info.data.members.length} members</T>
        <NetText net={myNet} big />
      </Card>
      <Segmented label="Expenses or balances" value={tab} onChange={setTab} options={[{ key: 'expenses', label: 'Expenses' }, { key: 'balances', label: 'Balances' }]} />
      {tab === 'expenses' ? <ExpenseList id={id} me={me} name={name} /> : <Balances id={id} me={me} name={name} members={info.data.members} groupName={info.data.name} />}
    </Screen>
  );
}

function ExpenseList({ id, me, name }: { id: string; me: string; name: (u: string) => string }) {
  const c = useColors();
  const q = useExpenses(id);
  const { saves, deletes } = usePendingExpenses(id);
  const rows = useMemo(() => {
    const server = (q.data?.pages.flat() ?? []).filter((e) => !deletes.has(e.id));
    const pendingIds = new Set(saves.map((s) => s.id));
    const all = [...saves, ...server.filter((e) => !pendingIds.has(e.id))];
    return all.sort((a, b) => (a.expense_date === b.expense_date ? b.created_at.localeCompare(a.created_at) : b.expense_date.localeCompare(a.expense_date)));
  }, [q.data, saves, deletes]);

  if (q.isLoading && saves.length === 0) return <Loading />;
  if (q.error && !q.data) return <ErrorBox message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={{ flex: 1 }}
      data={rows}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ gap: space(2), paddingBottom: space(4) }}
      onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
      onEndReachedThreshold={0.5}
      initialNumToRender={15}
      windowSize={7}
      ListEmptyComponent={<Empty title="No expenses yet" text="Add the first one, or scan a bill." />}
      ListFooterComponent={q.isFetchingNextPage ? <Loading /> : undefined}
      renderItem={({ item: e }) => <ExpenseRow e={e} me={me} name={name} onPress={() => router.push(`/group/${id}/expense?eid=${e.id}`)} />}
    />
  );
}

function ExpenseRow({ e, me, name, onPress }: { e: Expense; me: string; name: (u: string) => string; onPress: () => void }) {
  const c = useColors();
  const mine = Number(e.expense_splits.find((s) => s.user_id === me)?.amount_owed ?? 0);
  const paidByMe = e.paid_by === me;
  const lent = paidByMe ? Number(e.total_amount) - mine : 0;
  const cat = categoryOf(e.category);
  let share: { text: string; color: string };
  if (paidByMe && lent > 0) share = { text: `you lent ${formatINR(lent)}`, color: c.owed };
  else if (!paidByMe && mine > 0) share = { text: `your share ${formatINR(mine)}`, color: c.owe };
  else share = { text: 'not involved', color: c.muted };
  return (
    <Card onPress={onPress} label={`${e.description}, ${formatINR(Number(e.total_amount))}`} style={{ paddingVertical: space(3), flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <View style={{ width: 44, alignItems: 'center' }}>
        <T v="small">{formatDate(e.expense_date).split(' ').slice(0, 2).join(' ')}</T>
        <T v="h2">{cat.emoji}</T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1} style={{ fontWeight: '600' }}>{e.description}</T>
        <T v="small" numberOfLines={1}>{name(e.paid_by)} paid {formatINR(Number(e.total_amount))}</T>
        {e.pending && <T v="small" color={c.owe}>⏳ Waiting to sync</T>}
      </View>
      <T v="small" color={share.color} style={{ fontWeight: '700', textAlign: 'right', maxWidth: 130 }}>{share.text}</T>
    </Card>
  );
}

function Balances({ id, me, name, members, groupName }: { id: string; me: string; name: (u: string) => string; members: Member[]; groupName: string }) {
  const c = useColors();
  const nets = useNets(id);
  const settlements = useSettlements(id);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRpc<{ p_group: string; p_from: string; p_amount: number }>('request_payment');
  const respond = useRpc<{ p_id: string; p_confirm: boolean }>('respond_settlement', () => [[...keys.group(id)], [...keys.notifications], [...keys.myGroups]]);
  const transfers = useMemo(() => {
    if (!nets.data) return [];
    try { return simplifyDebts(nets.data); } catch { return []; }
  }, [nets.data]);
  const open = (settlements.data ?? []).filter((s) => s.status === 'marked_paid');
  const profile = (uid: string) => members.find((m) => m.user_id === uid)?.profile;

  if (nets.isLoading) return <Loading />;
  if (nets.error && !nets.data) return <ErrorBox message={friendlyError(nets.error)} onRetry={() => nets.refetch()} />;
  return (
    <FlatList
      style={{ flex: 1 }}
      data={[] as never[]}
      renderItem={() => null}
      ListHeaderComponent={
        <View style={{ gap: space(3), paddingBottom: space(4) }}>
          <ErrorBox message={error} />
          {msg && <InfoBox tone="ok"><T>{msg}</T></InfoBox>}
          {open.length > 0 && (
            <>
              <T v="h2">Waiting for confirmation</T>
              {open.map((s) => (
                <Card key={s.id}>
                  <T>{name(s.from_user)} {s.from_user === me ? 'say' : 'says'} {s.from_user === me ? 'you' : 'they'} paid {name(s.to_user) === 'You' ? 'you' : name(s.to_user)} {formatINR(Number(s.amount))} {s.method === 'cash' ? 'in cash' : 'via UPI'}{s.upi_ref ? ` (ref ${s.upi_ref})` : ''}.</T>
                  {s.to_user === me ? (
                    <View style={{ flexDirection: 'row', gap: space(2) }}>
                      <Button title="Confirm received" variant="teal" style={{ flex: 1 }} loading={respond.isPending && respond.variables?.p_id === s.id && respond.variables.p_confirm}
                        onPress={() => respond.mutate({ p_id: s.id, p_confirm: true }, { onError: (e) => setError(friendlyError(e)), onSuccess: () => setMsg('Confirmed. The debt is cleared.') })} />
                      <Button title="Not received" variant="secondary" style={{ flex: 1 }} loading={respond.isPending && respond.variables?.p_id === s.id && !respond.variables.p_confirm}
                        onPress={() => respond.mutate({ p_id: s.id, p_confirm: false }, { onError: (e) => setError(friendlyError(e)), onSuccess: () => setMsg('Marked as not received. The debt stays open.') })} />
                    </View>
                  ) : <T v="small">Waiting for {name(s.to_user)} to confirm. The balance changes once they do.</T>}
                </Card>
              ))}
            </>
          )}
          <T v="h2">Who pays whom</T>
          {transfers.length === 0 && <InfoBox tone="ok"><T>Everyone is settled up. 🎉</T></InfoBox>}
          {transfers.map((t) => (
            <Card key={`${t.from}-${t.to}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                <Avatar name={name(t.from)} url={profile(t.from)?.avatar_url} size={32} />
                <T style={{ flex: 1 }}>
                  <T style={{ fontWeight: '700' }}>{name(t.from)}</T> {t.from === me ? 'pay' : 'pays'} <T style={{ fontWeight: '700' }}>{t.to === me ? 'you' : name(t.to)}</T>
                </T>
                <T v="money" color={t.from === me ? c.owe : t.to === me ? c.owed : c.text}>{formatINR(t.amount)}</T>
              </View>
              {t.from === me && (
                <>
                  {!profile(t.to)?.upi_id && <T v="small" color={c.owe}>{name(t.to)} hasn't added a UPI ID yet. You can still settle in cash.</T>}
                  <Button title="Settle up" onPress={() => router.push(`/group/${id}/settle?to=${t.to}&amount=${t.amount}`)} />
                </>
              )}
              {t.to === me && (
                <Button title="Request payment" variant="secondary" loading={request.isPending && request.variables?.p_from === t.from}
                  onPress={() => request.mutate({ p_group: id, p_from: t.from, p_amount: t.amount }, {
                    onError: (e) => setError(friendlyError(e)),
                    onSuccess: () => setMsg(`Asked ${name(t.from)} for ${formatINR(t.amount)}. They get a message in the app and by email.`),
                  })} />
              )}
            </Card>
          ))}
          <T v="h2">Everyone's balance</T>
          <Card>
            {members.map((m) => (
              <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 44 }}>
                <Avatar name={m.profile.full_name} url={m.profile.avatar_url} size={32} />
                <View style={{ flex: 1 }}>
                  <NetText net={nets.data?.[m.user_id] ?? 0} who={m.user_id === me ? undefined : m.profile.full_name.split(' ')[0]} />
                </View>
              </View>
            ))}
          </Card>
          <T v="small">"Who pays whom" uses the fewest payments that clear every balance. Payments count only after the person receiving them confirms.</T>
        </View>
      }
    />
  );
}
