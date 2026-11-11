import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Button, Card, ErrorView, Field, Loading, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { addMember, cancelInvite, deleteGroup, getGroupInviteLink, removeMember, resetGroupInviteLink, updateGroup } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useGroup } from '@/lib/hooks';
import { inviteLink } from '@/lib/links';
import { useSync } from '@/lib/offline';
import { invalidateMoney, queryClient, qk } from '@/lib/query';
import { openWhatsApp, shareText } from '@/lib/share';
import type { GroupType } from '@/lib/types';
import { space } from '@/theme';

export default function EditGroup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const { profile } = useAuth();
  const { online } = useSync();
  const group = useGroup(id);
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('other');
  const [contact, setContact] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (group.data) {
      setName(group.data.name);
      setType(group.data.type);
    }
  }, [group.data]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: qk.group(id) });
      invalidateMoney(id);
      if (ok) setMsg({ text: ok, bad: false });
    } catch (e) {
      setMsg({ text: errText(e), bad: true });
    } finally {
      setBusy(null);
    }
  };

  if (group.isLoading) return <Screen back title="Group settings"><Loading /></Screen>;
  if (group.error && !group.data) return <Screen back title="Group settings"><ErrorView error={group.error} /></Screen>;
  const g = group.data!;
  const isAdmin = g.members.some((m) => m.user_id === me && m.role === 'admin');
  if (!isAdmin) return <Screen back title="Group settings"><T>Only the group admin can change this group.</T></Screen>;

  const inviteText = (token: string) => `${profile?.full_name ?? 'A friend'} added you to "${g.name}" on SplitIt. Join here: ${inviteLink(token)}`;
  const share = (token: string) => shareText(inviteText(token))
    .then((r) => setMsg({ text: r === 'copied' ? 'Invite link copied.' : 'Invite shared.', bad: false }));

  return (
    <Screen back title="Group settings" subtitle={g.name}>
      {!online ? <T color="muted">Changing the group needs a connection.</T> : null}
      {msg ? <T color={msg.bad ? 'danger' : 'positive'}>{msg.text}</T> : null}
      <View style={{ gap: space[4] }}>
        <Field label="Group name" value={name} onChangeText={setName} maxLength={60} />
        <Segmented label="Type" value={type} onChange={setType}
          options={[{ value: 'trip', label: 'Trip' }, { value: 'flat', label: 'Flat' }, { value: 'other', label: 'Other' }]} />
        <Button label="Save" variant="secondary" disabled={!online} loading={busy === 'save'} onPress={() => act('save', () => updateGroup(id, name, type), 'Group saved.')} />
      </View>

      <View style={{ gap: space[2] }}>
        <T v="heading">Members</T>
        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Field label="Add by phone or email" value={contact} onChangeText={setContact} autoCapitalize="none" keyboardType="email-address" /></View>
          <Button label="Add" variant="secondary" disabled={!online || !contact.trim()} loading={busy === 'add'}
            onPress={() => act('add', async () => {
              const r = await addMember(id, contact);
              setContact('');
              if (r.status === 'invited' && r.token) {
                if (r.kind === 'phone') await openWhatsApp(r.contact, inviteText(r.token));
                else await share(r.token);
              }
              setMsg({ text: r.status === 'added' ? `${r.name} was added.` : r.status === 'already_member' ? 'They are already in this group.' : `${r.contact} is not on SplitIt yet. ${r.kind === 'phone' ? 'Send the invite on WhatsApp, or share the link another way' : 'Send them the invite link (we also emailed one, but it may not arrive)'}.`, bad: false });
            })} />
        </View>
        <Card>
          {g.members.map((m, i) => (
            <Row key={m.user_id} first={i === 0}>
              <Avatar name={m.profile.full_name} uri={m.profile.avatar_url} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T v="bodyStrong" lines={1}>{m.user_id === me ? 'You' : m.profile.full_name}</T>
                <T v="caption" color="muted" lines={1}>{m.profile.phone ?? m.profile.email}</T>
              </View>
              {m.role === 'admin' ? <Pill tone="brand">Admin</Pill> : (
                <Button small variant="quiet" label="Remove" disabled={!online} loading={busy === m.user_id}
                  onPress={() => act(m.user_id, () => removeMember(id, m.user_id), `${m.profile.full_name} was removed.`)} />
              )}
            </Row>
          ))}
          {g.invites.map((inv) => (
            <Row key={inv.id}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T lines={1}>{inv.contact}</T>
                <T v="caption" color="pending">Invited, not joined yet</T>
              </View>
              {inv.contact_kind === 'phone' ? (
                <Button small variant="secondary" label="WhatsApp" onPress={() => void openWhatsApp(inv.contact, inviteText(inv.token))} />
              ) : null}
              <Button small variant="secondary" label="Share" onPress={() => void share(inv.token)} />
              <Button small variant="quiet" label="Cancel" disabled={!online} onPress={() => act(inv.id, () => cancelInvite(inv.id))} />
            </Row>
          ))}
        </Card>
      </View>

      <View style={{ gap: space[2] }}>
        <T v="heading">Invite link</T>
        <T color="muted">Anyone with the group's link can sign up or log in and join. Reset it if it was sent to the wrong person; the old link stops working.</T>
        <View style={{ flexDirection: 'row', gap: space[3], flexWrap: 'wrap' }}>
          <Button small variant="secondary" label="Share invite link" disabled={!online} loading={busy === 'link'}
            onPress={() => act('link', async () => { await share(await getGroupInviteLink(id)); })} />
          <Button small variant="quiet" label="Reset link" disabled={!online} loading={busy === 'reset'}
            onPress={() => act('reset', () => resetGroupInviteLink(id), 'Old invite link cancelled. Share the new one.')} />
        </View>
      </View>

      {confirmDelete ? (
        <Card style={{ padding: space[4], gap: space[3] }}>
          <T>Delete {g.name} for everyone? All its expenses and payments are removed. This cannot be undone.</T>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <Button style={{ flex: 1 }} variant="secondary" label="Keep group" onPress={() => setConfirmDelete(false)} />
            <Button style={{ flex: 1 }} variant="danger" label="Delete" loading={busy === 'delete'} disabled={!online}
              onPress={() => act('delete', async () => { await deleteGroup(id); router.replace('/'); })} />
          </View>
        </Card>
      ) : <Button variant="danger" label="Delete group" onPress={() => setConfirmDelete(true)} />}
    </Screen>
  );
}
