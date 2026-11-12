import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { addDays, formatDate, MONTH_NAMES, monthGrid, todayISO } from '@/core';
import { MIN_TOUCH, radius, space, useColors } from '@/lib/theme';
import { Button, Chip, Sheet, T } from './ui';

/** Calendar date picker, the same on every platform. Value is "YYYY-MM-DD" in local (IST) time; shown as "3 Nov 2026". */
export function DateField({ value, onChange, label = 'Date' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const c = useColors();
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const [open, setOpen] = useState(false);
  const [y, m] = value.split('-').map(Number);
  const [view, setView] = useState<{ y: number; m: number }>({ y, m: m - 1 });
  const cells = monthGrid(view.y, view.m);
  const step = (d: number) => setView((v) => { const n = new Date(v.y, v.m + d, 1); return { y: n.getFullYear(), m: n.getMonth() }; });
  const isFutureMonth = new Date(view.y, view.m + 1, 1) > new Date();

  return (
    <View style={{ gap: space(1) }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip label="Today" selected={value === today} onPress={() => onChange(today)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => onChange(yesterday)} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Pick a date, currently ${formatDate(value)}`} onPress={() => { setView({ y, m: m - 1 }); setOpen(true); }}
          style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(4), borderRadius: 999, justifyContent: 'center', borderWidth: 1.5,
            borderColor: value !== today && value !== yesterday ? c.primary : c.border, backgroundColor: c.surface }}>
          <T style={{ fontWeight: '600' }}>📅 {formatDate(value)}</T>
        </Pressable>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Pick a date">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Button title="‹" variant="ghost" label="Previous month" onPress={() => step(-1)} />
          <T v="h2" style={{ flex: 1, textAlign: 'center' }}>{MONTH_NAMES[view.m]} {view.y}</T>
          <Button title="›" variant="ghost" label="Next month" disabled={isFutureMonth} onPress={() => step(1)} />
        </View>
        <View style={{ flexDirection: 'row' }}>
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <T key={d} v="small" style={{ flex: 1, textAlign: 'center' }}>{d}</T>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((d, i) => {
            const future = d !== null && d > today;
            const sel = d === value;
            return (
              <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                {d && (
                  <Pressable accessibilityRole="button" accessibilityLabel={formatDate(d)} accessibilityState={{ selected: sel, disabled: future }} disabled={future}
                    onPress={() => { onChange(d); setOpen(false); }}
                    style={{ flex: 1, minHeight: 40, borderRadius: radius.s, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: sel ? c.primary : d === today ? c.surface2 : 'transparent', opacity: future ? 0.3 : 1 }}>
                    <T color={sel ? c.onPrimary : c.text} style={{ fontWeight: sel || d === today ? '700' : '400' }}>{Number(d.slice(8))}</T>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}
