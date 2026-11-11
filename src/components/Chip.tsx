import { Pressable } from 'react-native';
import { T } from './ui';
import { radius, space, useColors } from '@/theme';

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={{ minHeight: 36, paddingHorizontal: space[3], borderRadius: radius.full, borderWidth: 1, justifyContent: 'center',
        backgroundColor: on ? c.brandSoft : c.surface, borderColor: on ? c.brand : c.line }}>
      <T v="label" color={on ? 'brand' : 'muted'}>{label}</T>
    </Pressable>
  );
}
