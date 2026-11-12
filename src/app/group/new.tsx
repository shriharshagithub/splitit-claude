import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AddPeople } from '@/components/AddPeople';
import { Button, Chip, ErrorBox, Field, Screen, T } from '@/components/ui';
import { keys } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import { GROUP_TYPES, type GroupType } from '@/lib/types';

export default function NewGroup() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('trip');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  async function create() {
    setError(null);
    if (!name.trim()) return setError('Give the group a name.');
    setBusy(true);
    const { data, error: e } = await supabase.rpc('create_group', { p_name: name.trim(), p_type: type });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    qc.invalidateQueries({ queryKey: keys.myGroups });
    setCreated({ id: data as string, name: name.trim() });
  }

  if (created) {
    return (
      <Screen title={created.name} footer={<Button title="Done, open the group" onPress={() => router.replace(`/group/${created.id}`)} />}>
        <T v="h2">Who's in?</T>
        <T>Add friends by mobile number or email. You can always add more later.</T>
        <AddPeople groupId={created.id} groupName={created.name} />
      </Screen>
    );
  }
  return (
    <Screen title="New group" footer={<Button title="Create group" onPress={create} loading={busy} />}>
      <Field label="Group name" value={name} onChangeText={setName} placeholder="Goa Trip, Flat 402…" maxLength={60} onSubmitEditing={create} />
      <T v="label">Type</T>
      <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
        {GROUP_TYPES.map((t) => <Chip key={t.key} label={`${t.emoji} ${t.label}`} selected={type === t.key} onPress={() => setType(t.key)} />)}
      </View>
      <ErrorBox message={error} />
    </Screen>
  );
}
