import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorView, Loading, Money, OfflineBanner, Pill, Row, Section, T } from '@/components/ui';
import { getSettlementStatuses, markNotificationsRead, respondSettlement } from '@/lib/api';
import { errText } from '@/lib/errors';
import { useActivity, useNotifications } from '@/lib/hooks';
import { useSync } from '@/lib/offline';
import { invalidateMoney, queryClient, qk } from '@/lib/query';
import type { Notification } from '@/lib/types';
import { space, useColors } from '@/theme';

const WHEN = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Activity() {
  const c = useColors();
  const { online } = useSync();
  const notes = useNotifications();
  const log = useActivity();
  const [answer, setAnswer] = useState<Record<string, string>>({});

  const claims = useMemo(() => (notes.data ?? []).filter((n) => n.type === 'payment_marked' || n.type === 'confirm_nudge'), [notes.data]);
  const ids = useMemo(() => [...new Set(claims.map((n) => String(n.payload.settlement_id)))], [claims]);
  const statuses = useQuery({ queryKey: ['claim-status', ids], queryFn: () => getSettlementStatuses(ids), enabled: ids.length > 0 });
  const open = claims.filter((n, i, all) => statuses.data?.[String(n.payload.settlement_id)] === 'marked_paid'
    && all.findIndex((x) => x.payload.settlement_id === n.payload.settlement_id) === i);

  const respond = useMutation({
    mutationFn: ({ sid, accept }: { sid: string; accept: boolean }) => respondSettlement(sid, accept),
    onSuccess: (_, v) => {
      setAnswer((a) => ({ ...a, [v.sid]: v.accept ? 'Confirmed. The debt is cleared.' : 'Marked as not received. Their balance is unchanged.' }));
      invalidateMoney();
      void queryClient.invalidateQueries({ queryKey: ['claim-status'] });
    },
    onError: (e, v) => setAnswer((a) => ({ ...a, [v.sid]: errText(e) })),
  });

  // Opening Activity marks notifications as read.
  useFocusEffect(useCallback(() => {
    const unread = (notes.data ?? []).filter((n) => !n.read_at && n.type !== 'payment_marked').map((n) => n.id);
    if (unread.length && online) void markNotificationsRead(unread).then(() => queryClient.invalidateQueries({ queryKey: qk.notifications }));
  }, [notes.data, online]));

  const go = (n: Notification) => {
    if (!n.group_id) return;
    if ((n.type === 'payment_request' || n.type === 'reminder') && n.payload.creditor) router.push(`/group/${n.group_id}/settle/${n.payload.creditor}`);
    else router.push(`/group/${n.group_id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[2] }}><T v="title">Activity</T></View>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[6], paddingBottom: space[12] }}
        refreshControl={<RefreshControl refreshing={notes.isRefetching || log.isRefetching} onRefresh={() => { void notes.refetch(); void log.refetch(); void statuses.refetch(); }} />}>
        {open.length > 0 && (
          <Section title="Needs your answer">
            {open.map((n) => {
              const sid = String(n.payload.settlement_id);
              return (
                <Card key={sid} style={{ padding: space[4], gap: space[3] }}>
                  <T>{n.body.replace(/ Confirm\?$/, '')}</T>
                  <T v="caption" color="muted">Check your bank app first. Confirming clears the debt.</T>
                  {answer[sid] ? <T v="label" color="muted">{answer[sid]}</T> : (
                    <View style={{ flexDirection: 'row', gap: space[3] }}>
                      <Button style={{ flex: 1 }} variant="danger" label="Not received" disabled={!online || respond.isPending}
                        onPress={() => respond.mutate({ sid, accept: false })} />
                      <Button style={{ flex: 1 }} label="Confirm" disabled={!online || respond.isPending}
                        onPress={() => respond.mutate({ sid, accept: true })} />
                    </View>
                  )}
                  {!online ? <T v="caption" color="muted">Answering needs a connection.</T> : null}
                </Card>
              );
            })}
          </Section>
        )}

        <Section title="Notifications">
          {notes.isLoading ? <Loading /> : notes.error && !notes.data ? <ErrorView error={notes.error} onRetry={() => void notes.refetch()} /> : (
            (notes.data ?? []).length === 0 ? <Card style={{ padding: space[4] }}><T color="muted">Nothing yet. Payment requests, claims and reminders show up here.</T></Card> : (
              <Card>
                {(notes.data ?? []).slice(0, 25).map((n, i) => (
                  <Row key={n.id} first={i === 0} onPress={n.group_id ? () => go(n) : undefined} label={n.body}>
                    {!n.read_at ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} /> : <View style={{ width: 8 }} />}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T v="bodyStrong" lines={1}>{n.title}</T>
                      <T v="label" color="muted">{n.body}</T>
                      <T v="caption" color="muted">{WHEN.format(new Date(n.created_at))}</T>
                    </View>
                    {n.type === 'payment_confirmed' ? <Pill tone="done">Done</Pill> : n.type === 'payment_declined' ? <Pill tone="declined">Not received</Pill> : null}
                  </Row>
                ))}
              </Card>
            )
          )}
        </Section>

        <Section title="In your groups">
          {log.isLoading ? <Loading /> : log.error && !log.data ? <ErrorView error={log.error} onRetry={() => void log.refetch()} /> : (
            <Card>
              {(log.data ?? []).map((a, i) => (
                <Row key={a.id} first={i === 0} onPress={() => router.push(`/group/${a.group_id}`)} label={a.summary}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T>{a.summary}</T>
                    <T v="caption" color="muted">{a.group_name} · {WHEN.format(new Date(a.created_at))}</T>
                  </View>
                  {a.amount ? <Money paise={a.amount} v="amountSm" color="muted" /> : null}
                </Row>
              ))}
            </Card>
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
