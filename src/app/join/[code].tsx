import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorBox, Loading, Screen, T } from '@/components/ui';
import { keys } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { GROUP_TYPES } from '@/lib/types';
import { PENDING_JOIN } from '@/lib/config';

/** Opened from an invite link or invite email. Logged-out visitors log in or sign up first, then come back here. */
export default function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{ group_id: string; name: string; type: string; members: number; invited_by: string } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('invite_preview', { p_code: code }).then(({ data, error: e }) => {
      if (e) setError(friendlyError(e));
      setPreview((data as any) ?? null);
    });
  }, [code]);

  async function join() {
    if (!session) {
      await AsyncStorage.setItem(PENDING_JOIN, code);
      router.replace('/login');
      return;
    }
    setBusy(true);
    const { data, error: e } = await supabase.rpc('join_group', { p_code: code });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    qc.invalidateQueries({ queryKey: keys.myGroups });
    router.replace(`/group/${data}`);
  }

  return (
    <Screen title="Join a group" back={false}>
      {preview === undefined && <Loading />}
      {preview === null && <ErrorBox message="This invite link has expired or was reset. Ask your friend for a new one." />}
      {preview && (
        <Card style={{ alignItems: 'center' }}>
          <T v="title">{GROUP_TYPES.find((t) => t.key === preview.type)?.emoji}</T>
          <T v="h2">{preview.name}</T>
          <T v="small">{preview.members} members · started by {preview.invited_by}</T>
          <T style={{ textAlign: 'center' }}>{session ? 'Join this group to see and add shared expenses.' : 'Log in or sign up, and we will add you to this group.'}</T>
          <ErrorBox message={error} />
          <Button title={session ? 'Join group' : 'Log in or sign up to join'} onPress={join} loading={busy} style={{ alignSelf: 'stretch' }} />
        </Card>
      )}
      {preview === null && <Button title="Open SplitIt" onPress={() => router.replace('/')} />}
    </Screen>
  );
}
