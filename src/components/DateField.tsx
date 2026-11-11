import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Chip } from './Chip';
import { Button, Sheet, T } from './ui';
import { addDays, formatDate, fromIsoDate, localToday, toIsoDate } from '@/core';
import { radius, space, useColors } from '@/theme';

export interface DateFieldProps {
  label: string;
  value: string; // YYYY-MM-DD, local time
  onChange: (iso: string) => void;
  editable?: boolean;
}

/** Date picker: Today / Yesterday shortcuts plus the phone's own calendar. Future dates are not allowed. */
export function DateField({ label, value, onChange, editable = true }: DateFieldProps) {
  const c = useColors();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const today = localToday();

  const openCalendar = () => {
    if (!editable) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: fromIsoDate(value),
        mode: 'date',
        maximumDate: fromIsoDate(today),
        onChange: (e, d) => { if (e.type === 'set' && d) onChange(toIsoDate(d)); },
      });
    } else {
      setDraft(value);
      setIosOpen(true);
    }
  };

  return (
    <View style={{ gap: space[2] }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        <Chip label="Today" on={value === today} onPress={() => editable && onChange(today)} />
        <Chip label="Yesterday" on={value === addDays(today, -1)} onPress={() => editable && onChange(addDays(today, -1))} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${formatDate(value)}. Choose a date`} onPress={openCalendar}
          style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], borderRadius: radius.sm, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <Calendar size={18} color={c.brand} />
          <T v="bodyStrong">{formatDate(value)}</T>
        </Pressable>
      </View>
      {Platform.OS === 'ios' && (
        <Sheet visible={iosOpen} onClose={() => setIosOpen(false)} title={label}>
          <DateTimePicker value={fromIsoDate(draft)} mode="date" display="inline" maximumDate={fromIsoDate(today)}
            onChange={(_, d) => d && setDraft(toIsoDate(d))} />
          <Button label="Done" onPress={() => { onChange(draft); setIosOpen(false); }} />
        </Sheet>
      )}
    </View>
  );
}
