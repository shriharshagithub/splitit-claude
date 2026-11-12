import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useOnline } from '@/lib/network';
import { outbox, usePendingOps } from '@/lib/outboxInstance';
import { space, useColors } from '@/lib/theme';
import { T } from './ui';

/** Shows offline state, how many changes are waiting to sync, and any sync notices (conflicts). */
export function OfflineBanner() {
  const online = useOnline();
  const pending = usePendingOps().length;
  const c = useColors();
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { const off = outbox.onNotice((n) => setNotice(n.text)); return () => { off(); }; }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);
  if (online && pending === 0 && !notice) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ backgroundColor: online ? c.surface2 : c.oweBg, paddingHorizontal: space(4), paddingVertical: space(2), gap: 2 }}>
      {!online && <T v="label" color={c.text}>You are offline. You can still read and add expenses.</T>}
      {pending > 0 && <T v="small" color={c.text}>{pending} change{pending === 1 ? '' : 's'} waiting to sync{online ? '… syncing now' : ' when you are back online'}.</T>}
      {notice && <T v="small" color={c.text}>{notice}</T>}
    </View>
  );
}
