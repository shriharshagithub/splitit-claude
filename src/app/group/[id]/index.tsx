import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, Clock, Plus, Settings, UserPlus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { Avatar, Button, Card, ErrorView, IconButton, Loading, Money, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { formatINR } from '@/core';
import { getGroupInviteLink, requestPayment } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { inviteLink } from '@/lib/links';
import { shareText } from '@/lib/share';
import { errText } from '@/lib/errors';
import { useExpenseFeed, useGroup, useOpenSettlements, useTransfers } from '@/lib/hooks';
import { useSync } from '@/lib/offline';
import { invalidateMoney } from '@/lib/query';
import type { ExpenseRow } from '@/lib/types';
import { space, useColors } from '@/theme';

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' });
const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const asDate = (d: string) => new Date(`${d}T00:00:00`);

export default function GroupDetail() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: 'expenses' | 'balances' }>();
  const c = useColors();
  const me = useMe();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'expenses' | 'balances'>(initialTab ?? 'expenses');
  const group = useGroup(id);
  const { transfers, nets, error: netsErr, refetch: refetchNets } = useTransfers(id);
  const feed = useExpenseFeed(id, me);
  const settlements = useOpenSettlements(id);
  const { online, outbox } = useSync();
  const [msg, setMsg] = useState<string | null>(null);

  const names = useMemo(() => Object.fromEntries((group.data?.members ?? []).map((m) => [m.user_id, m.profile.full_name])), [group.data]);
  const first = (uid: string) => (uid === me ? 'You' : (names[uid] ?? 'Someone').split(' ')[0]);
  const isAdmin = group.data?.members.some((m) => m.user_id === me && m.role === 'admin');
  const myNet = nets?.[me] ?? 0;

  const request = useMutation({
    mutationFn: (t: { from: string; amount: number }) => requestPayment(id, t.from, t.amount),
    onSuccess: (_, t) => { setMsg(`Asked ${first(t.from)} for ${formatINR(t.amount)}. They get an email and a notification.`); invalidateMoney(id); },
    onError: (e) => setMsg(errText(e)),
  });

  const invite = useMutation({
    mutationFn: async () => {
      const token = await getGroupInviteLink(id);
      const g = group.data!;
      return shareText(`${profile?.full_name?.split(' ')[0] ?? 'A friend'} invited you to "${g.name}" on SplitIt, to split expenses and settle up over UPI. Join here: ${inviteLink(token)}`);
    },
    onSuccess: (r) => setMsg(r === 'copied' ? 'Invite link copied. Paste it into WhatsApp or SMS.' : 'Invite link shared.'),
    onError: (e) => setMsg(errText(e)),
  });

  if (group.isLoading) return <Screen back title=" "><Loading /></Screen>;
  if (group.error && !group.data) return <Screen back title="Group"><ErrorView error={group.error} onRetry={() => void group.refetch()} /></Screen>;
  const g = group.data!;

  const header = (
    <View style={{ gap: space[3], paddingBottom: space[3] }}>
      <View style={{ gap: 2 }}>
        <T v="display" lines={2}>{g.name}</T>
        <T v="caption" color="muted">
          {g.members.length} members{nets ? ' · ' : ''}
          {nets ? (myNet === 0 ? 'you are settled up' : myNet > 0 ? 'you are owed ' : 'you owe ') : ''}
          {nets && myNet !== 0 ? <T v="amountSm" color={myNet > 0 ? 'positive' : 'negative'}>{formatINR(Math.abs(myNet))}</T> : null}
        </T>
      </View>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'expenses', label: 'Expenses' }, { value: 'balances', label: 'Balances' }]} />
      {msg ? <T v="label" color="muted" accessibilityLiveRegion="polite">{msg}</T> : null}
    </View>
  );

  const renderExpense = ({ item, index }: { item: ExpenseRow; index: number }) => {
    const prev = feed.rows[index - 1];
    const month = MONTH.format(asDate(item.expense_date));
    const showMonth = !prev || MONTH.format(asDate(prev.expense_date)) !== month;
    const paidByMe = item.paid_by === me;
    const lent = paidByMe ? item.total_amount - item.my_owed : 0;
    return (
      <View>
        {showMonth && <T v="overline" color="muted" style={{ paddingTop: space[4], paddingBottom: space[2] }}>{month}</T>}
        <Card style={{ borderRadius: 0, borderTopWidth: showMonth ? 1 : 0 }}>
          <Row first onPress={() => router.push(`/group/${id}/expense?expenseId=${item.id}`)} label={`${item.description}, ${formatINR(item.total_amount)}`}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="heading" lines={1}>{item.description}</T>
              {item.pending ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Clock size={14} color={c.pending} />
                  <T v="caption" color="pending">{first(item.paid_by)} paid · waiting to sync</T>
                </View>
              ) : <T v="caption" color="muted">{first(item.paid_by)} paid · {DAY.format(asDate(item.expense_date))}</T>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Money paise={item.total_amount} />
              {item.pending ? <T v="caption" color="muted">share after sync</T>
                : paidByMe && lent > 0 ? <T v="caption" color="positive">you lent <T v="amountSm" color="positive">{formatINR(lent)}</T></T>
                : !paidByMe && item.my_owed > 0 ? <T v="caption" color="negative">you borrowed <T v="amountSm" color="negative">{formatINR(item.my_owed)}</T></T>
                : <T v="caption" color="muted">not involved</T>}
            </View>
          </Row>
        </Card>
      </View>
    );
  };

  const open = settlements.data ?? [];
  const balances = (
    <View style={{ gap: space[4] }}>
      {outbox.some((o) => o.groupId === id) && <T v="caption" color="muted">Balances update once your offline changes sync.</T>}
      {netsErr && !nets ? <ErrorView error={netsErr} onRetry={refetchNets} /> : !transfers ? <Loading /> : transfers.length === 0 ? (
        <Card style={{ padding: space[4] }}><T>Everyone is settled up in this group.</T></Card>
      ) : (
        <>
          <T v="caption" color="muted">{transfers.length === 1 ? '1 payment clears' : `${transfers.length} payments clear`} every debt in this group.</T>
          {transfers.some((t) => t.to === me) && profile && !profile.upi_id ? (
            <Card style={{ padding: space[3], gap: space[2], backgroundColor: c.accentSoft, borderColor: c.accentSoft }}>
              <T v="label" color="pending">Add your UPI ID so people who owe you can pay by UPI. Until then they can only settle in cash.</T>
              <Button small label="Add UPI ID" onPress={() => router.push('/profile')} style={{ alignSelf: 'flex-start' }} />
            </Card>
          ) : null}
          <Card>
            {transfers.map((t, i) => {
              const claim = open.find((s) => s.from_user === t.from && s.to_user === t.to && s.status === 'marked_paid');
              const started = open.find((s) => s.from_user === t.from && s.to_user === t.to && s.status === 'pending');
              const declined = open.find((s) => s.from_user === t.from && s.to_user === t.to && s.status === 'declined');
              const mine = t.from === me || t.to === me;
              return (
                <Row key={`${t.from}-${t.to}`} first={i === 0}>
                  <Avatar name={names[t.from] ?? '?'} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T lines={2}><T v="bodyStrong">{first(t.from)}</T> {t.from === me ? 'owe' : 'owes'} <T v="bodyStrong">{t.to === me ? 'you' : first(t.to)}</T></T>
                    <Money paise={t.amount} color={!mine ? 'ink' : t.to === me ? 'positive' : 'negative'} />
                    {declined && t.from === me && !claim ? <T v="caption" color="danger">{first(t.to)} did not receive your last payment.</T> : null}
                  </View>
                  {claim ? (
                    t.to === me ? <Button small variant="secondary" label="Confirm" onPress={() => router.push('/activity')} />
                      : <Pill tone="pending">{t.from === me ? `Waiting for ${first(t.to)}` : 'Awaiting confirmation'}</Pill>
                  ) : t.from === me ? (
                    <Button small variant="secondary" label={started ? 'Finish paying' : 'Settle up'} onPress={() => router.push(`/group/${id}/settle/${t.to}`)} />
                  ) : t.to === me ? (
                    <Button small variant="secondary" label="Request" disabled={!online || request.isPending}
                      onPress={() => request.mutate({ from: t.from, amount: t.amount })} />
                  ) : null}
                </Row>
              );
            })}
          </Card>
        </>
      )}
      <T v="caption" color="muted">Debts older than 3 days get an automatic reminder. A debt clears only when the person who is owed confirms the payment.</T>
    </View>
  );

  return (
    <Screen back scroll={false} padded={false}
      right={
        <View style={{ flexDirection: 'row' }}>
          <IconButton label="Invite people with a link" onPress={() => { if (online) invite.mutate(); else setMsg('Sharing an invite needs a connection.'); }}>
            <UserPlus color={c.ink} size={24} strokeWidth={1.75} />
          </IconButton>
          {isAdmin ? <IconButton label="Group settings" onPress={() => router.push(`/group/${id}/edit`)}><Settings color={c.ink} size={24} strokeWidth={1.75} /></IconButton> : null}
        </View>
      }
      footer={
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <Button style={{ flex: 1 }} variant="secondary" label="Scan bill" icon={<Camera size={20} color={c.brand} />} onPress={() => router.push(`/group/${id}/scan`)} />
          <Button style={{ flex: 1 }} label="Add expense" icon={<Plus size={20} color={c.onBrand} />} onPress={() => router.push(`/group/${id}/expense`)} />
        </View>
      }>
      {tab === 'expenses' ? (
        <FlatList
          data={feed.rows}
          keyExtractor={(r) => r.id}
          renderItem={renderExpense}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: space[4], paddingBottom: space[12] }}
          onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage(); }}
          onEndReachedThreshold={0.5}
          initialNumToRender={15}
          windowSize={7}
          refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => { void feed.refetch(); refetchNets(); void settlements.refetch(); }} />}
          ListEmptyComponent={feed.isLoading ? <Loading /> : feed.error ? <ErrorView error={feed.error} onRetry={() => void feed.refetch()} /> : (
            <Card style={{ padding: space[4], gap: space[2] }}><T v="heading">No expenses yet</T><T color="muted">Add the first one, or scan a bill.</T></Card>
          )}
          ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator style={{ margin: space[4] }} /> : undefined}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space[4], paddingBottom: space[12] }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => { refetchNets(); void settlements.refetch(); }} />}>
          {header}{balances}
        </ScrollView>
      )}
    </Screen>
  );
}
