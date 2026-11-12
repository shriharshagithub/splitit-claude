import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { isEmail, normalizeIndianPhone } from '@/core';
import { Button, ErrorBox, Field, InfoBox, PasswordField, Screen, Segmented, T } from '@/components/ui';
import { googleEnabled, logIn, sendPasswordReset, signInWithGoogle, signUp } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { space, useColors } from '@/lib/theme';

type Mode = 'login' | 'signup' | 'forgot';

export default function Login() {
  const c = useColors();
  const [mode, setMode] = useState<Mode>('login');
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [google, setGoogle] = useState<boolean | null>(null);
  useEffect(() => { googleEnabled().then(setGoogle); }, []);

  async function go() {
    setError(null); setInfo(null);
    const e: Record<string, string> = {};
    if (mode === 'signup') {
      if (!name.trim()) e.name = 'Please enter your name.';
      if (!isEmail(email)) e.email = 'Please enter a valid email address.';
      if (!normalizeIndianPhone(phone)) e.phone = 'Enter a 10-digit Indian mobile number.';
      if (password.length < 8) e.password = 'Use at least 8 characters.';
    } else if (mode === 'login') {
      if (!identifier.trim()) e.identifier = 'Enter your email or mobile number.';
      if (!password) e.password = 'Enter your password.';
    } else if (!isEmail(email)) e.email = 'Please enter a valid email address.';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (mode === 'login') await logIn(identifier, password);
      else if (mode === 'signup') await signUp({ full_name: name.trim(), email: email.trim(), phone, password });
      else setInfo(await sendPasswordReset(email.trim()));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function googleGo() {
    setError(null);
    if (google === false) { setError('Google sign-in is not switched on yet. Use email or mobile number for now.'); return; }
    try { await signInWithGoogle(); } catch (err) { setError(friendlyError(err)); }
  }

  return (
    <Screen back={false}>
      <View style={{ alignItems: 'center', gap: space(2), marginTop: space(8), marginBottom: space(4) }}>
        <Logo />
        <T v="title">SplitIt</T>
        <T style={{ textAlign: 'center' }} color={c.muted}>Share expenses with friends. Settle up over UPI.</T>
      </View>
      {mode !== 'forgot' && (
        <Segmented label="Log in or sign up" value={mode} onChange={(m) => { setMode(m); setError(null); setErrs({}); }}
          options={[{ key: 'login', label: 'Log in' }, { key: 'signup', label: 'Sign up' }]} />
      )}
      {mode === 'forgot' && <T v="h2">Reset your password</T>}

      {mode === 'login' && (
        <>
          <Field label="Email or mobile number" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" autoComplete="username" placeholder="you@example.com or 98xxx xxxxx" error={errs.identifier} onSubmitEditing={go} />
          <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="current-password" error={errs.password} onSubmitEditing={go} />
        </>
      )}
      {mode === 'signup' && (
        <>
          <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" placeholder="Priya Sharma" error={errs.name} />
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="you@example.com" error={errs.email} hint="For password reset and payment messages." />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="98xxx xxxxx" error={errs.phone} hint="Friends can add you with this number." />
          <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="new-password" error={errs.password} hint="At least 8 characters." onSubmitEditing={go} />
        </>
      )}
      {mode === 'forgot' && (
        <>
          <T color={c.muted}>Enter the email on your account. We will send a link to choose a new password.</T>
          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errs.email} onSubmitEditing={go} />
        </>
      )}

      <ErrorBox message={error} />
      {info && <InfoBox tone="ok"><T>{info}</T></InfoBox>}
      <Button title={mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset link'} onPress={go} loading={busy} />

      {mode === 'login' && (
        <Pressable accessibilityRole="button" onPress={() => { setMode('forgot'); setError(null); setEmail(identifier.includes('@') ? identifier : ''); }}
          style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'center' }}>
          <T v="label" color={c.primary}>Forgot password?</T>
        </Pressable>
      )}
      {mode === 'forgot' && <Button title="Back to log in" variant="ghost" onPress={() => { setMode('login'); setInfo(null); }} />}

      {mode !== 'forgot' && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} /><T v="small">or</T><View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>
          <Button title="Continue with Google" variant="secondary" onPress={googleGo} />
        </>
      )}
    </Screen>
  );
}

function Logo() {
  const c = useColors();
  return (
    <View accessibilityLabel="SplitIt logo" style={{ width: 64, height: 64, borderRadius: 32, overflow: 'hidden', flexDirection: 'row', transform: [{ rotate: '-20deg' }] }}>
      <View style={{ flex: 1, backgroundColor: c.primary }} />
      <View style={{ width: 4, backgroundColor: c.bg }} />
      <View style={{ flex: 1, backgroundColor: c.accent }} />
    </View>
  );
}
