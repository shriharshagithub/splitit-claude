import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Field, Screen, T } from '@/components/ui';
import { updatePassword } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toAppError } from '@/lib/errors';

export default function ResetPassword() {
  const { session, clearRecovery } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session) {
    return (
      <Screen title="Reset password">
        <T>This reset link has expired or was already used. Ask for a new one from the log in screen.</T>
        <Button label="Go to log in" onPress={() => router.replace('/login?mode=forgot')} />
      </Screen>
    );
  }
  const save = async () => {
    setError(null);
    if (pw.length < 8) return setError('Use at least 8 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await updatePassword(pw);
      clearRecovery();
      router.replace('/');
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Choose a new password">
      <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" />
      <Field label="Type it again" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" error={error} />
      <Button label="Save password" onPress={save} loading={busy} />
    </Screen>
  );
}
