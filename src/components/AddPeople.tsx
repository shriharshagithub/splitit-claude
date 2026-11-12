import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { formatPhone, isEmail, normalizeIndianPhone } from '@/core';
import { invalidateGroup } from '@/lib/api';
import { friendlyError } from '@/lib/errors';
import { inviteMessage, openUrl, whatsAppUrl } from '@/lib/share';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/lib/theme';
import { Button, ErrorBox, Field, InfoBox, T } from './ui';

export interface AddResult { status: 'added' | 'invited' | 'already_member'; name?: string; kind?: 'phone' | 'email'; contact?: string; token?: string }

/** Adds one person by phone or email and explains what happened in plain words. */
export function AddPeople({ groupId, groupName }: { groupId: string; groupName: string }) {
  const c = useColors();
  const qc = useQueryClient();
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AddResult[]>([]);

  async function add() {
    setError(null);
    const v = contact.trim();
    if (!v.includes('@') && !normalizeIndianPhone(v)) return setError('Enter a 10-digit Indian mobile number or an email address.');
    if (v.includes('@') && !isEmail(v)) return setError('That email address does not look right.');
    setBusy(true);
    const { data, error: e } = await supabase.rpc('add_member', { p_group: groupId, p_contact: v });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    setResults((r) => [data as AddResult, ...r]);
    setContact('');
    invalidateGroup(qc, groupId);
  }

  return (
    <View style={{ gap: space(3) }}>
      <Field label="Add by mobile number or email" value={contact} onChangeText={setContact} autoCapitalize="none" autoCorrect={false}
        placeholder="98xxx xxxxx or friend@email.com" onSubmitEditing={add} />
      <ErrorBox message={error} />
      <Button title="Add person" variant="teal" onPress={add} loading={busy} />
      {results.map((r, i) => <ResultLine key={i} r={r} groupName={groupName} />)}
      {results.length > 0 && <T v="small" color={c.muted}>Add as many people as you like.</T>}
    </View>
  );
}

export function ResultLine({ r, groupName }: { r: AddResult; groupName: string }) {
  if (r.status === 'added') return <InfoBox tone="ok"><T>✓ {r.name} is on SplitIt and has been added. We emailed them too.</T></InfoBox>;
  if (r.status === 'already_member') return <InfoBox><T>{r.name} is already in this group.</T></InfoBox>;
  if (r.kind === 'email') return <InfoBox tone="ok"><T>✓ {r.contact} isn't on SplitIt yet. We emailed them an invite; they join this group as soon as they sign up.</T></InfoBox>;
  return (
    <InfoBox tone="warn">
      <T>{formatPhone(r.contact)} isn't on SplitIt yet. Send them the invite; they join this group as soon as they sign up with this number.</T>
      <Button title="Send on WhatsApp" variant="teal" small style={{ alignSelf: 'flex-start' }}
        onPress={() => openUrl(whatsAppUrl(r.contact!, inviteMessage(groupName, r.token!)))} />
    </InfoBox>
  );
}
