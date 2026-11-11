import { Activity, User, Users } from 'lucide-react-native';
import { Tabs } from 'expo-router/js-tabs';
import { useUnreadCount } from '@/lib/hooks';
import { font, useColors } from '@/theme';

export default function TabsLayout() {
  const c = useColors();
  const unread = useUnreadCount();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, minHeight: 64 },
        tabBarItemStyle: { paddingVertical: 4 },
        tabBarLabelStyle: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18 },
        sceneStyle: { backgroundColor: c.ground },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Groups', tabBarIcon: ({ color }) => <Users color={color} size={24} strokeWidth={1.75} /> }} />
      <Tabs.Screen name="activity" options={{
        title: 'Activity',
        tabBarBadge: unread > 0 ? unread : undefined,
        tabBarBadgeStyle: { backgroundColor: c.accent, color: c.onAccent },
        tabBarIcon: ({ color }) => <Activity color={color} size={24} strokeWidth={1.75} />,
      }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <User color={color} size={24} strokeWidth={1.75} /> }} />
    </Tabs>
  );
}
