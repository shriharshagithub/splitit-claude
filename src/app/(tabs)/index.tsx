import { router } from 'expo-router';
import { Bell, Plus } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorView, Loading, Money, OfflineBanner, Pill, Row, SplitDisc, T } from '@/components/ui';
import { useMyGroups, useUnreadCount } from '@/lib/hooks';
import { radius, space, useColors } from '@/theme';

export default function Home() {
  const c = useColors();
  const groups = useMyGroups();
  const unread = useUnreadCount();
  const list = groups.data ?? [];
  const owed = list.filter((g) => g.my_net > 0).reduce((a, g) => a + Number(g.my_net), 0);
  const owe = list.filter((g) => g.my_net < 0).reduce((a, g) => a - Number(g.my_net), 0);
  const net = owed - owe;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.ground }} edges={['top', 'left', 'right']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingTop: space[2] }}>
        <T v="title" style={{ fontFamily: 'AnekLatin_700Bold' }}>SplitIt</T>
        <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={() => router.push('/activity')}
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Bell color={c.ink} size={24} strokeWidth={1.75} />
          {unread > 0 && (
            <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <T v="overline" style={{ color: c.onAccent, letterSpacing: 0 }}>{unread > 99 ? '99+' : String(unread)}</T>
            </View>
          )}
        </Pressable>
      </View>
      <OfflineBanner />
      <ScrollView contentContainerStyle={{ padding: space[4], gap: space[6], paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={groups.isRefetching} onRefresh={() => void groups.refetch()} />}>
        {groups.isLoading ? <Loading /> : groups.error && !groups.data ? <ErrorView error={groups.error} onRetry={() => void groups.refetch()} /> : (
          <>
            <Card style={{ padding: space[4], gap: space[1] }}>
              <T v="caption" color="muted">Across all your groups</T>
              {net === 0 ? (
                <T v="amountXl" color="muted">settled up</T>
              ) : (
                <>
                  <T v="bodyStrong" color={net > 0 ? 'positive' : 'negative'}>{net > 0 ? 'you are owed' : 'you owe'}</T>
                  <Money paise={net} abs v="amountXl" color={net > 0 ? 'positive' : 'negative'} />
                </>
              )}
              {(owed > 0 || owe > 0) && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingTop: space[2] }}>
                  {owed > 0 && <Pill tone="owed">owed to you <Money paise={owed} v="amountSm" color="positive" /></Pill>}
                  {owe > 0 && <Pill tone="owe">you owe <Money paise={owe} v="amountSm" color="negative" /></Pill>}
                </View>
              )}
            </Card>

            {list.length === 0 ? (
              <Card style={{ padding: space[6], gap: space[4], alignItems: 'flex-start' }}>
                <SplitDisc size={48} />
                <T v="heading">No groups yet</T>
                <T color="muted">Create a group for your flat, a trip or a dinner, add friends, and start splitting.</T>
                <Button label="Create a group" onPress={() => router.push('/group/new')} />
              </Card>
            ) : (
              <View style={{ gap: space[2] }}>
                <T v="heading">Your groups</T>
                <Card>
                  {list.map((g, i) => (
                    <Row key={g.id} first={i === 0} onPress={() => router.push(`/group/${g.id}`)} label={`${g.name}, ${g.member_count} members`}>
                      <SplitDisc />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T v="heading" lines={1}>{g.name}</T>
                        <T v="caption" color="muted">{g.member_count} {g.member_count === 1 ? 'member' : 'members'}</T>
                      </View>
                      {Number(g.my_net) === 0 ? <T v="caption" color="muted">settled up</T> : (
                        <View style={{ alignItems: 'flex-end' }}>
                          <T v="caption" color={g.my_net > 0 ? 'positive' : 'negative'}>{g.my_net > 0 ? 'you are owed' : 'you owe'}</T>
                          <Money paise={Number(g.my_net)} abs color={g.my_net > 0 ? 'positive' : 'negative'} />
                        </View>
                      )}
                    </Row>
                  ))}
                </Card>
              </View>
            )}
          </>
        )}
      </ScrollView>
      {list.length > 0 && (
        <Pressable accessibilityRole="button" accessibilityLabel="New group" onPress={() => router.push('/group/new')}
          style={{ position: 'absolute', right: space[4], bottom: space[4], height: 56, paddingHorizontal: 20, borderRadius: radius.full, backgroundColor: c.brand, flexDirection: 'row', alignItems: 'center', gap: space[2], elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
          <Plus color={c.onBrand} size={22} strokeWidth={2} />
          <T v="bodyStrong" style={{ color: c.onBrand }}>New group</T>
        </Pressable>
      )}
    </SafeAreaView>
  );
}
