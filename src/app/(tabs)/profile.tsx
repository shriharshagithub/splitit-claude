import * as Sentry from '@sentry/react-native';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Avatar, Button, Field, Screen, Segmented, T } from '@/components/ui';
import { isValidUpiId } from '@/core';
import { setMyPhone, updateProfile, uploadAvatar } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useSync } from '@/lib/offline';
import { queryClient, qk } from '@/lib/query';
import { space } from '@/theme';

type Freq = 'daily' | 'weekly' | 'off';
const FREQ_HELP: Record<Freq, string> = {
  daily: 'Every morning while you owe money that is more than 3 days old.',
  weekly: 'Once a week while you owe money that is more than 3 days old.',
  off: 'No reminders. You still see what you owe on Home.',
};

export default function Profile() {
  const { profile, session, signOut } = useAuth();
  const { online } = useSync();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [phone, setPhone] = useState('');
  const [freq, setFreq] = useState<Freq>('daily');
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [crashArmed, setCrashArmed] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name);
    setUpi(profile.upi_id ?? '');
    setFreq(profile.reminder_frequency ?? 'daily');
  }, [profile]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.profile(session!.user.id) });

  const save = async () => {
    setMsg(null);
    if (!name.trim()) return setMsg({ text: 'Enter your name.', bad: true });
    if (upi.trim() && !isValidUpiId(upi)) return setMsg({ text: 'Check the UPI ID. It should look like name@bank.', bad: true });
    setBusy(true);
    try {
      await updateProfile(session!.user.id, { full_name: name.trim(), upi_id: upi.trim() || null, reminder_frequency: freq });
      if (!profile?.phone && phone.trim()) await setMyPhone(phone);
      await refresh();
      setMsg({ text: 'Saved.', bad: false });
    } catch (e) {
      setMsg({ text: errText(e), bad: true });
    } finally {
      setBusy(false);
    }
  };

  const changePhoto = async () => {
    setMsg(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    try {
      const url = await uploadAvatar(session!.user.id, a.uri, a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg');
      await updateProfile(session!.user.id, { avatar_url: url });
      await refresh();
    } catch (e) {
      setMsg({ text: errText(e), bad: true });
    }
  };

  return (
    <Screen title="Profile"
      footer={<View style={{ gap: space[2] }}>
        {msg ? <T color={msg.bad ? 'danger' : 'positive'}>{msg.text}</T> : null}
        <Button label="Save changes" onPress={save} loading={busy} disabled={!online} />
        {!online ? <T v="caption" color="muted">Saving your profile needs a connection.</T> : null}
      </View>}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
        <Avatar name={profile?.full_name ?? ''} uri={profile?.avatar_url} size={64} />
        <Button small variant="secondary" label="Change photo" onPress={changePhoto} disabled={!online} />
      </View>
      <Field label="Full name" value={name} onChangeText={setName} maxLength={80} />
      {profile?.phone
        ? <Field label="Phone" value={profile.phone.replace(/^\+91/, '+91 ')} editable={false} help="You log in with this number." />
        : <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" help="Add your mobile number so friends can add you to groups." />}
      <Field label="Email" value={profile?.email ?? ''} editable={false} help="Password resets and payment messages go here." />
      <Field label="UPI ID" value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder="name@oksbi"
        help="Friends pay you here. Without it, they can only settle with you in cash." />
      <View style={{ gap: space[1] }}>
        <Segmented label="Remind me about money I owe" value={freq} onChange={setFreq}
          options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'off', label: 'Off' }]} />
        <T v="caption" color="muted">{FREQ_HELP[freq]}</T>
      </View>
      <Button variant="danger" label="Log out" onPress={() => void signOut()} />

      <View style={{ gap: space[2] }}>
        <T v="overline" color="muted">Support</T>
        <Pressable accessibilityRole="button" onPress={() => {
          if (!crashArmed) return setCrashArmed(true);
          Sentry.captureMessage('Test crash requested from Profile');
          throw new Error('SplitIt test crash from the Profile screen');
        }}>
          <T v="label" color="brand">{crashArmed ? 'Tap again to send a test crash report' : 'Send a test crash report'}</T>
        </Pressable>
        {crashArmed ? (
          <Button small variant="quiet" label="Crash the app natively (Android/iOS builds)" onPress={() => Sentry.nativeCrash()} />
        ) : null}
      </View>
    </Screen>
  );
}
