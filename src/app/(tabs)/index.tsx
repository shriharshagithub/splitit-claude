import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { formatINR } from '@/core';
import { Button, Card, Empty, ErrorBox, InfoBox, Loading, NetText, Screen, T } from '@/components/ui';
import { useMe, useMyGroups, useNotifications } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { useLiveGroups } from '@/lib/realtime';
import { MIN_TOUCH, space, useColors } from '@/lib/theme';
import { GROUP_TYPES } from '@/lib/types';

export default function Home() {
  const c = useColors();
  const groups = useMyGroups();
  const me = useMe();
  const unread = (useNotifications().data ?? []).filter((n) => !n.read_at).length;
  useLiveGroups((groups.data ?? []).map((g) => g.id));
  const list = groups.data ?? [];
  const total = list.reduce((a, g) => a + Number(g.my_net), 0);
  const owedSomewhere = list.some((g) => Number(g.my_net) > 0);

  return (
    <Screen back={false} title={`Hi ${me.data?.full_name?.split(' ')[0] ?? ''}`.trim()}
      right={
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push('/activity')}
          style={{ minWidth: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}>
          <T v="h2">🔔</T>
          {unread > 0 && (
            <View style={{ position: 'absolute', top: 4, right: 2, backgroundColor: c.danger, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <T v="label" color="#fff" style={{ fontSize: 12 }}>{unread}</T>
            </View>
          )}
        </Pressable>
      }>
      <Card style={{ backgroundColor: c.surface2 }}>
        <T v="label">Across all your groups</T>
        <NetText net={total} big />
      </Card>
      {owedSomewhere && me.data && !me.data.upi_id && (
        <InfoBox tone="warn">
          <T>People owe you money. Add your UPI ID so they can pay you straight from their UPI app.</T>
          <Button title="Add UPI ID" small variant="teal" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/profile')} />
        </InfoBox>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <T v="h2" style={{ flex: 1 }}>Your groups</T>
        <Button title="+ New group" small variant="teal" onPress={() => router.push('/group/new')} />
      </View>
      {groups.isLoading && <Loading />}
      {groups.error && !groups.data && <ErrorBox message={friendlyError(groups.error)} onRetry={() => groups.refetch()} />}
      {groups.data && list.length === 0 && (
        <Empty title="No groups yet" text="Make a group for a trip, your flat or anything you share, then add friends."
          action={<Button title="Create a group" onPress={() => router.push('/group/new')} />} />
      )}
      {list.map((g) => {
        const t = GROUP_TYPES.find((x) => x.key === g.type);
        return (
          <Card key={g.id} onPress={() => router.push(`/group/${g.id}`)} label={`${g.name}, ${g.member_count} members`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <T v="h2">{t?.emoji}</T>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="h2" numberOfLines={1}>{g.name}</T>
                <T v="small">{t?.label} · {g.member_count} {g.member_count === 1 ? 'member' : 'members'}</T>
              </View>
            </View>
            <NetText net={Number(g.my_net)} />
          </Card>
        );
      })}
      {list.length > 0 && <T v="small" style={{ textAlign: 'center' }}>Total of all groups: {formatINR(Math.abs(total))} {total > 0 ? 'owed to you' : total < 0 ? 'you owe' : ''}</T>}
    </Screen>
  );
}
