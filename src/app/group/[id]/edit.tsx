import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { formatPhone } from '@/core';
import { AddPeople } from '@/components/AddPeople';
import { Avatar, Button, Card, Chip, Divider, ErrorBox, Field, InfoBox, Loading, Screen, T } from '@/components/ui';
import { invalidateGroup, keys, useGroupInfo, useInvites } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useLiveGroups } from '@/lib/realtime';
import { copy, inviteMessage, joinUrl, openUrl, shareText, whatsAppUrl } from '@/lib/share';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/lib/theme';
import { GROUP_TYPES, type GroupType } from '@/lib/types';

function confirmAsk(title: string, text: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  return new Promise((res) => Alert.alert(title, text, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Yes', style: 'destructive', onPress: () => res(true) }]));
}

export default function GroupSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const qc = useQueryClient();
  const me = useUserId();
  const info = useGroupInfo(id);
  useLiveGroups([id]);
  const isAdmin = info.data?.members.find((m) => m.user_id === me)?.role === 'admin';
  const invites = useInvites(id, isAdmin);
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('other');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (info.data) { setName(info.data.name); setType(info.data.type); } }, [info.data]);
  useEffect(() => { supabase.rpc('group_invite_code', { p_group: id }).then(({ data }) => setCode((data as string) ?? null)); }, [id]);

  async function run(label: string, f: () => PromiseLike<{ error: any }>, after?: () => void) {
    setError(null); setMsg(null); setBusy(label);
    const { error: e } = await f();
    setBusy(null);
    if (e) return setError(friendlyError(e));
    invalidateGroup(qc, id);
    qc.invalidateQueries({ queryKey: keys.invites(id) });
    after?.();
  }

  if (!info.data) return <Screen title="Group">{info.error ? <ErrorBox message={friendlyError(info.error)} /> : <Loading />}</Screen>;
  const g = info.data;
  return (
    <Screen title={isAdmin ? 'Edit group' : 'Group members'}>
      {isAdmin && (
        <Card>
          <Field label="Group name" value={name} onChangeText={setName} maxLength={60} />
          <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
            {GROUP_TYPES.map((t) => <Chip key={t.key} label={`${t.emoji} ${t.label}`} selected={type === t.key} onPress={() => setType(t.key)} />)}
          </View>
          <Button title="Save" variant="teal" loading={busy === 'save'} onPress={() => run('save', () => supabase.rpc('update_group', { p_group: id, p_name: name, p_type: type }), () => setMsg('Saved.'))} />
        </Card>
      )}
      <ErrorBox message={error} />
      {msg && <InfoBox tone="ok"><T>{msg}</T></InfoBox>}

      <T v="h2">Members ({g.members.length})</T>
      <Card>
        {g.members.map((m, i) => (
          <View key={m.user_id} style={{ gap: space(2) }}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 48 }}>
              <Avatar name={m.profile.full_name} url={m.profile.avatar_url} />
              <View style={{ flex: 1 }}>
                <T>{m.profile.full_name}{m.user_id === me ? ' (you)' : ''}</T>
                <T v="small">{m.role === 'admin' ? 'Admin · ' : ''}{m.profile.phone ? formatPhone(m.profile.phone) : m.profile.email}</T>
                {!m.profile.upi_id && <T v="small" color={c.owe}>No UPI ID yet</T>}
              </View>
              {isAdmin && m.user_id !== me && (
                <Button title="Remove" small variant="ghost" loading={busy === m.user_id} onPress={async () => {
                  if (await confirmAsk(`Remove ${m.profile.full_name}?`, 'They will no longer see this group. Their past expenses stay.')) {
                    run(m.user_id, () => supabase.rpc('remove_member', { p_group: id, p_user: m.user_id }));
                  }
                }} />
              )}
            </View>
          </View>
        ))}
      </Card>

      {isAdmin && (invites.data?.length ?? 0) > 0 && (
        <>
          <T v="h2">Invited, not joined yet</T>
          <Card>
            {invites.data!.map((inv, i) => (
              <View key={inv.id} style={{ gap: space(2) }}>
                {i > 0 && <Divider />}
                <T>{inv.phone ? formatPhone(inv.phone) : inv.email}</T>
                <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
                  {inv.phone && <Button title="Send on WhatsApp" small variant="teal" onPress={() => openUrl(whatsAppUrl(inv.phone!, inviteMessage(g.name, inv.token)))} />}
                  <Button title="Share link" small variant="secondary" onPress={async () => { if ((await shareText(inviteMessage(g.name, inv.token))) === 'copied') setMsg('Invite copied. Paste it in any chat.'); }} />
                  <Button title="Cancel invite" small variant="ghost" loading={busy === inv.id} onPress={() => run(inv.id, () => supabase.rpc('cancel_invite', { p_invite: inv.id }))} />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      {isAdmin && (
        <>
          <T v="h2">Add people</T>
          <Card><AddPeople groupId={id} groupName={g.name} /></Card>
        </>
      )}

      {code && (
        <>
          <T v="h2">Invite link</T>
          <Card>
            <T v="small">Anyone with this link can join the group after logging in.</T>
            <T selectable numberOfLines={2}>{joinUrl(code)}</T>
            <View style={{ flexDirection: 'row', gap: space(2), flexWrap: 'wrap' }}>
              <Button title="Copy link" small variant="teal" onPress={async () => { await copy(joinUrl(code)); setMsg('Link copied.'); }} />
              <Button title="Share" small variant="secondary" onPress={async () => { if ((await shareText(inviteMessage(g.name, code))) === 'copied') setMsg('Invite copied. Paste it in any chat.'); }} />
              {isAdmin && (
                <Button title="Reset link" small variant="ghost" loading={busy === 'reset'} onPress={async () => {
                  if (!(await confirmAsk('Reset the invite link?', 'The old link stops working. People already in the group stay.'))) return;
                  setBusy('reset');
                  const { data, error: e } = await supabase.rpc('reset_invite_code', { p_group: id });
                  setBusy(null);
                  if (e) setError(friendlyError(e)); else { setCode(data as string); setMsg('New link made. The old one no longer works.'); }
                }} />
              )}
            </View>
          </Card>
        </>
      )}

      <Divider />
      <Button title="Leave group" variant="secondary" loading={busy === 'leave'} onPress={async () => {
        if (await confirmAsk('Leave this group?', 'You can only leave once you are settled up.')) {
          run('leave', () => supabase.rpc('remove_member', { p_group: id, p_user: me }), () => router.replace('/'));
        }
      }} />
      {isAdmin && (
        <Button title="Delete group" variant="danger" loading={busy === 'delete'} onPress={async () => {
          if (await confirmAsk(`Delete "${g.name}"?`, 'This deletes the group, its expenses and payments for everyone. It cannot be undone.')) {
            run('delete', () => supabase.rpc('delete_group', { p_group: id }), () => { qc.removeQueries({ queryKey: keys.group(id) }); router.replace('/'); });
          }
        }} />
      )}
    </Screen>
  );
}
