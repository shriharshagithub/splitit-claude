import { Calendar } from 'lucide-react-native';
import { View } from 'react-native';
import { Chip } from './Chip';
import { T } from './ui';
import type { DateFieldProps } from './DateField';
import { addDays, formatDate, localToday } from '@/core';
import { radius, space, useColors } from '@/theme';

/**
 * Web: Today / Yesterday shortcuts plus the browser's calendar. The date is always shown as
 * "3 Nov 2026"; the browser's own date box is invisible on top of it, because browsers format
 * that box from the phone's language (11/03/2026 on a US-English phone means 3 Nov).
 */
export function DateField({ label, value, onChange, editable = true }: DateFieldProps) {
  const c = useColors();
  const today = localToday();
  return (
    <View style={{ gap: space[2] }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        <Chip label="Today" on={value === today} onPress={() => editable && onChange(today)} />
        <Chip label="Yesterday" on={value === addDays(today, -1)} onPress={() => editable && onChange(addDays(today, -1))} />
        <View style={{ position: 'relative', minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <Calendar size={18} color={c.brand} />
          <T v="bodyStrong">{formatDate(value)}</T>
          <input
            type="date"
            aria-label={`${label}: ${formatDate(value)}. Choose a date`}
            value={value}
            max={today}
            disabled={!editable}
            onClick={(e) => {
              try {
                (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
              } catch {
                /* older browsers open the picker on tap anyway */
              }
            }}
            onChange={(e) => { if (e.target.value && e.target.value <= today) onChange(e.target.value); }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0, margin: 0 }}
          />
        </View>
      </View>
    </View>
  );
}
