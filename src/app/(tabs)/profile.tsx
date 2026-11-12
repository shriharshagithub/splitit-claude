import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatPhone, isValidUpiId, normalizeIndianPhone } from '@/core';
import { Avatar, Button, Card, ErrorBox, Field, InfoBox, Loading, Screen, Segmented, T } from '@/components/ui';
import { keys, useMe } from '@/lib/api';
import { logOut } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { pickImage } from '@/lib/images';
import { report, sentryOn } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/lib/theme';

type Freq = 'daily' | 'weekly' | 'off';

export default function Profile() {
  const c = useColors();
  const qc = useQueryClient();
  const me = useMe();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [upi, setUpi] = useState('');
  const [freq, setFreq] = useState<Freq>('daily');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [crash, setCrash] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.full_name ?? '');
    setPhone(me.data.phone ? me.data.phone.replace(/^91/, '') : '');
    setUpi(me.data.upi_id ?? '');
    setFreq((me.data.reminder_freq as Freq) ?? 'daily');
  }, [me.data]);

  if (crash) throw new Error('Test crash from the Profile screen (SplitIt crash-report check)');

  const phoneErr = phone && !normalizeIndianPhone(phone) ? 'Enter a 10-digit Indian mobile number.' : null;
  const upiErr = upi && !isValidUpiId(upi) ? 'A UPI ID looks like name@bank (for example priya@okhdfcbank).' : null;

  async function save(avatarUrl?: string) {
    setError(null); setSaved(false);
    if (!name.trim()) return setError('Please enter your name.');
    if (phoneErr || upiErr) return;
    setBusy(true);
    const { error: e } = await supabase.rpc('update_profile', {
      p_full_name: name.trim(), p_phone: phone ? normalizeIndianPhone(phone) : null, p_upi_id: upi.trim() || null, p_reminder_freq: freq, p_avatar_url: avatarUrl ?? null,
    });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    setSaved(true);
    qc.invalidateQueries({ queryKey: keys.me });
    qc.invalidateQueries({ queryKey: ['group'] });
  }

  async function photo(camera: boolean) {
    setError(null);
    try {
      const img = await pickImage({ camera, maxBytes: 500_000, maxSide: 512, square: true });
      if (!img || !me.data) return;
      setPhotoBusy(true);
      const path = `${me.data.id}/${Date.now()}.jpg`;
      const { error: e } = await supabase.storage.from('avatars').upload(path, img.bytes, { contentType: 'image/jpeg' });
      if (e) throw e;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      await save(url);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  if (me.isLoading) return <Screen back={false} title="Profile"><Loading /></Screen>;
  return (
    <Screen back={false} title="Profile">
      <View style={{ alignItems: 'center', gap: space(2) }}>
        <Avatar name={me.data?.full_name} url={me.data?.avatar_url} size={88} />
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          <Button title="Take photo" small variant="secondary" onPress={() => photo(true)} loading={photoBusy} />
          <Button title="Choose photo" small variant="secondary" onPress={() => photo(false)} loading={photoBusy} />
        </View>
      </View>
      <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
      <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98xxx xxxxx" error={phoneErr}
        hint={me.data?.phone ? `Saved as ${formatPhone(me.data.phone)}` : 'Add it so friends can add you by number.'} />
      <Field label="Email" value={me.data?.email ?? ''} editable={false} hint="Used to log in and for password reset." />
      <Field label="UPI ID" value={upi} onChangeText={setUpi} autoCapitalize="none" autoCorrect={false} placeholder="name@okhdfcbank" error={upiErr}
        hint="Friends pay you here. SplitIt never touches the money." />
      <View style={{ gap: space(1) }}>
        <T v="label">Payment reminders</T>
        <Segmented label="Reminder frequency" value={freq} onChange={setFreq} options={[{ key: 'daily', label: 'Daily' }, { key: 'weekly', label: 'Weekly' }, { key: 'off', label: 'Off' }]} />
        <T v="small">When you owe money for more than 3 days, we remind you at 9:00 am IST by email and in the app.</T>
      </View>
      <ErrorBox message={error} />
      {saved && <InfoBox tone="ok"><T>Saved.</T></InfoBox>}
      <Button title="Save changes" onPress={() => save()} loading={busy} />
      <Card style={{ marginTop: space(4) }}>
        <Button title="Log out" variant="secondary" onPress={logOut} />
        <Pressable accessibilityRole="button" onPress={() => { report(new Error('Test error report from Profile (handled)'), 'profile'); setCrash(true); }} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
          <T v="small" color={c.muted}>Send a test crash report{sentryOn ? '' : ' (crash reporting is not set up yet)'}</T>
        </Pressable>
      </Card>
    </Screen>
  );
}
