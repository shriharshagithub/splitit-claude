import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useNotifications } from '@/lib/api';
import { useColors } from '@/lib/theme';

export default function TabsLayout() {
  const c = useColors();
  const unread = (useNotifications().data ?? []).filter((n) => !n.read_at).length;
  const icon = (glyph: string) => ({ color }: { color: any }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 64, paddingBottom: 8, paddingTop: 6 },
      tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
      sceneStyle: { backgroundColor: c.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Groups', tabBarIcon: icon('👥'), tabBarAccessibilityLabel: 'Groups' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('🔔'), tabBarBadge: unread ? unread : undefined, tabBarAccessibilityLabel: `Activity${unread ? `, ${unread} unread` : ''}` }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('🙂'), tabBarAccessibilityLabel: 'Profile' }} />
    </Tabs>
  );
}
