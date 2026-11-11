import * as WebBrowser from 'expo-web-browser';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Field, Screen, Segmented, SplitDisc, T } from '@/components/ui';
import { acceptInvite, invitePreview, loginWithPhone, sendPasswordReset, signUp } from '@/lib/api';
import { toAppError } from '@/lib/errors';
import { authRedirect, WEB_URL } from '@/lib/links';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/theme';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'login' | 'signup' | 'forgot';

export default function Login() {
  const params = useLocalSearchParams<{ invite?: string; mode?: Mode }>();
  const c = useColors();
  const [mode, setMode] = useState<Mode>(params.mode ?? (params.invite ? 'signup' : 'login'));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ group_name: string; invited_by: string } | null>(null);

  useEffect(() => {
    if (params.invite) invitePreview(params.invite).then((p) => p && !p.accepted && setInvite(p)).catch(() => undefined);
  }, [params.invite]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => run(async () => {
    if (mode === 'login') {
      await loginWithPhone(phone, password);
      if (params.invite) {
        const g = await acceptInvite(params.invite).catch(() => null);
        if (g) return void router.replace(`/group/${g}`);
      }
      router.replace('/');
    } else if (mode === 'signup') {
      await signUp({ full_name: name.trim(), phone, email, password, invite_token: params.invite });
      router.replace('/');
    } else {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) throw new Error('Enter the email on your account.');
      // Reset links always open the web app, which works on any device; app deep links are not needed.
      await sendPasswordReset(email, `${WEB_URL}/reset-password`);
      setInfo('If that email has an account, a reset link is on its way. It works once and expires in an hour.');
    }
  });

  const google = () => run(async () => {
    const redirectTo = authRedirect('/');
    const { data, error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web', queryParams: { prompt: 'select_account' } },
    });
    if (e) throw /not enabled|unsupported provider/i.test(e.message) ? new Error('Google sign-in is not set up yet. Use your phone number for now.') : e;
    if (Platform.OS !== 'web' && data?.url) {
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type === 'success') {
        const code = new URL(res.url).searchParams.get('code');
        if (code) {
          const { error: xe } = await supabase.auth.exchangeCodeForSession(code);
          if (xe) throw xe;
          router.replace('/');
        }
      }
    }
  });

  return (
    <Screen>
      <View style={{ gap: space[3], paddingTop: space[6] }}>
        <SplitDisc size={48} />
        <T v="display" accessibilityRole="header">SplitIt</T>
        <T color="muted">{invite ? `${invite.invited_by} invited you to ${invite.group_name}. Create your account to join.` : 'One person pays. Everyone settles over UPI.'}</T>
      </View>

      {mode !== 'forgot' && (
        <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }}
          options={[{ value: 'login', label: 'Log in' }, { value: 'signup', label: 'Sign up' }]} />
      )}

      <View style={{ gap: space[4] }}>
        {mode === 'forgot' && <T v="title">Reset your password</T>}
        {mode === 'signup' && <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />}
        {mode !== 'forgot' && (
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel"
            textContentType="telephoneNumber" placeholder="98450 12345" help={mode === 'signup' ? 'Indian mobile number. You log in with this.' : undefined} />
        )}
        {mode !== 'login' && (
          <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email"
            help={mode === 'signup' ? 'For password resets and payment messages.' : undefined} />
        )}
        {mode !== 'forgot' && (
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            help={mode === 'signup' ? 'At least 8 characters.' : undefined} onSubmitEditing={submit} />
        )}
        {error ? <T color="danger" selectable>{error}</T> : null}
        {info ? <T color="positive">{info}</T> : null}
        <Button label={mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Email me a reset link'} onPress={submit} loading={busy} />
        {mode === 'login' && <Button variant="quiet" label="Forgot password?" onPress={() => { setMode('forgot'); setError(null); }} />}
        {mode === 'forgot' && <Button variant="quiet" label="Back to log in" onPress={() => { setMode('login'); setInfo(null); }} />}
      </View>

      {mode !== 'forgot' && (
        <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.line }} /><T v="caption" color="muted">or</T><View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
          </View>
          <Button variant="secondary" label="Continue with Google" onPress={google} disabled={busy} />
        </View>
      )}
    </Screen>
  );
}
