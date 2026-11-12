import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Screen, T } from '@/components/ui';
import { acceptInvite, invitePreview } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toAppError } from '@/lib/errors';
import { invalidateMoney } from '@/lib/query';

export default function Invite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, loading } = useAuth();
  const [preview, setPreview] = useState<{ group_name: string; invited_by: string; accepted: boolean } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invitePreview(token).then(setPreview).catch(() => setPreview(null));
  }, [token]);

  const join = async () => {
    setBusy(true);
    try {
      const g = await acceptInvite(token);
      invalidateMoney();
      router.replace(`/group/${g}`);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  if (preview === undefined || loading) return <Screen title="Invite"><T color="muted">Checking your invite…</T></Screen>;
  if (preview === null) return <Screen title="Invite"><T>This invite link is not valid. Ask the person who invited you for a new one.</T></Screen>;
  return (
    <Screen title={`Join ${preview.group_name}`}>
      <T>{preview.invited_by} invited you to split expenses in {preview.group_name}.</T>
      {preview.accepted ? <T color="muted">This invite has already been used.</T> : null}
      {error ? <T color="danger">{error}</T> : null}
      {session
        ? <Button label={`Join ${preview.group_name}`} onPress={join} loading={busy} />
        : <Button label="Create an account to join" onPress={() => router.replace(`/login?invite=${token}`)} />}
      {!session && <Button variant="quiet" label="I already have an account" onPress={() => router.replace(`/login?invite=${token}&mode=login`)} />}
    </Screen>
  );
}
