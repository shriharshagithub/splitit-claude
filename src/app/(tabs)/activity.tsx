import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDateTimeIST, formatINR } from '@/core';
import { Button, Card, Empty, ErrorBox, Loading, Screen, Segmented, T } from '@/components/ui';
import { keys, useActivity, useNotifications, useRpc } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useLiveGroups } from '@/lib/realtime';
import { space, useColors } from '@/lib/theme';
import type { Notification } from '@/lib/types';

export default function Activity() {
  const c = useColors();
  const [tab, setTab] = useState<'inbox' | 'log'>('inbox');
  const notes = useNotifications();
  const log = useActivity();
  const qc = useQueryClient();
  const markRead = useRpc<{ p_ids: string[] | null }>('mark_notifications_read', () => [[...keys.notifications]]);
  useLiveGroups([...new Set((log.data ?? []).map((a) => a.group_id))]);

  // Opening the inbox marks plain messages as read; payment claims stay until answered.
  useEffect(() => {
    if (tab !== 'inbox' || !notes.data) return;
    const ids = notes.data.filter((n) => !n.read_at && n.type !== 'payment_marked' && n.type !== 'confirm_nudge').map((n) => n.id);
    if (ids.length) markRead.mutate({ p_ids: ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, notes.data?.length]);

  return (
    <Screen back={false} title="Activity">
      <Segmented label="Activity" value={tab} onChange={setTab} options={[{ key: 'inbox', label: 'For you' }, { key: 'log', label: 'All activity' }]} />
      {tab === 'inbox' && (
        <>
          {notes.isLoading && <Loading />}
          {notes.error && !notes.data && <ErrorBox message={friendlyError(notes.error)} onRetry={() => notes.refetch()} />}
          {notes.data?.length === 0 && <Empty title="Nothing yet" text="Payment requests, payment claims and reminders show up here." />}
          {notes.data?.map((n) => <NoteCard key={n.id} n={n} onDone={() => { qc.invalidateQueries({ queryKey: keys.notifications }); if (n.group_id) qc.invalidateQueries({ queryKey: keys.group(n.group_id) }); qc.invalidateQueries({ queryKey: keys.myGroups }); }} />)}
        </>
      )}
      {tab === 'log' && (
        <>
          {log.isLoading && <Loading />}
          {log.error && !log.data && <ErrorBox message={friendlyError(log.error)} onRetry={() => log.refetch()} />}
          {log.data?.length === 0 && <Empty title="No activity yet" text="Expenses, payments and new members in your groups show up here." />}
          {log.data?.map((a) => (
            <Card key={a.id} onPress={() => router.push(`/group/${a.group_id}`)} label={a.summary} style={{ paddingVertical: space(3) }}>
              <T>{a.summary}</T>
              <T v="small">{a.groups?.name} · {formatDateTimeIST(a.created_at)}</T>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

function NoteCard({ n, onDone }: { n: Notification; onDone: () => void }) {
  const c = useColors();
  const [error, setError] = useState<string | null>(null);
  const respond = useRpc<{ p_id: string; p_confirm: boolean }>('respond_settlement');
  const needsAnswer = (n.type === 'payment_marked' || n.type === 'confirm_nudge') && !n.read_at;
  const canPay = (n.type === 'payment_request' || n.type === 'reminder') && n.group_id && n.payload?.to_user;
  async function answer(confirm: boolean) {
    setError(null);
    try { await respond.mutateAsync({ p_id: n.payload.settlement_id, p_confirm: confirm }); onDone(); }
    catch (e) { setError(friendlyError(e)); }
  }
  return (
    <Card style={!n.read_at ? { borderColor: c.primary, borderWidth: 1.5 } : undefined}>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        {!n.read_at && <T v="label" color={c.primary}>● New</T>}
        <T v="small" style={{ flex: 1, textAlign: 'right' }}>{formatDateTimeIST(n.created_at)}</T>
      </View>
      <T v="h2">{n.title}</T>
      <T>{n.body}</T>
      <ErrorBox message={error} />
      {needsAnswer && n.payload?.settlement_id && (
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button title="Confirm received" variant="teal" style={{ flex: 1 }} loading={respond.isPending && respond.variables?.p_confirm === true} onPress={() => answer(true)} />
          <Button title="Not received" variant="secondary" style={{ flex: 1 }} loading={respond.isPending && respond.variables?.p_confirm === false} onPress={() => answer(false)} />
        </View>
      )}
      {canPay && (
        <Button title={`Pay ${formatINR(Number(n.payload.amount))}`} small style={{ alignSelf: 'flex-start' }}
          onPress={() => router.push(`/group/${n.group_id}/settle?to=${n.payload.to_user}&amount=${n.payload.amount}`)} />
      )}
      {!canPay && !needsAnswer && n.group_id && <Button title="Open group" small variant="ghost" style={{ alignSelf: 'flex-start' }} onPress={() => router.push(`/group/${n.group_id}`)} />}
    </Card>
  );
}
