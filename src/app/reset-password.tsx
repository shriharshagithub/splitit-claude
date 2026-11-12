import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, ErrorBox, InfoBox, Loading, PasswordField, Screen, T } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

/** Opened from the reset email. The single-use token is checked by Supabase, then a new password is set. */
export default function ResetPassword() {
  const { token_hash } = useLocalSearchParams<{ token_hash?: string }>();
  const [state, setState] = useState<'checking' | 'ready' | 'bad' | 'done'>('checking');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token_hash) { setState('bad'); return; }
    supabase.auth.verifyOtp({ token_hash, type: 'recovery' }).then(({ error: e }) => setState(e ? 'bad' : 'ready'));
  }, [token_hash]);

  async function save() {
    setError(null);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords are different.');
    setBusy(true);
    const { error: e } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (e) setError(friendlyError(e));
    else setState('done');
  }

  return (
    <Screen title="New password" back={false}>
      {state === 'checking' && <Loading />}
      {state === 'bad' && (
        <>
          <ErrorBox message="This reset link has already been used or has expired. Ask for a new one from the login screen." />
          <Button title="Go to log in" onPress={() => router.replace('/login')} />
        </>
      )}
      {state === 'ready' && (
        <>
          <T>Choose a new password for SplitIt.</T>
          <PasswordField label="New password" value={pw} onChangeText={setPw} autoComplete="new-password" hint="At least 8 characters." />
          <PasswordField label="Type it again" value={pw2} onChangeText={setPw2} autoComplete="new-password" onSubmitEditing={save} />
          <ErrorBox message={error} />
          <Button title="Save new password" onPress={save} loading={busy} />
        </>
      )}
      {state === 'done' && (
        <>
          <InfoBox tone="ok"><T>Your password has been changed. You are logged in.</T></InfoBox>
          <Button title="Open SplitIt" onPress={() => router.replace('/')} />
        </>
      )}
    </Screen>
  );
}
