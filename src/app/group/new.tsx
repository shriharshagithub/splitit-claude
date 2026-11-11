import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Field, IconButton, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { createGroup, type AddResult } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { toAppError } from '@/lib/errors';
import { inviteLink } from '@/lib/links';
import { useSync } from '@/lib/offline';
import { invalidateMoney } from '@/lib/query';
import { shareText } from '@/lib/share';
import type { GroupType } from '@/lib/types';
import { space, useColors } from '@/theme';

const CONTACT = /^(\+?91[\s-]?)?0?[6-9]\d{4}[\s-]?\d{5}$|^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function NewGroup() {
  const c = useColors();
  const { profile } = useAuth();
  const { online } = useSync();
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('trip');
  const [contact, setContact] = useState('');
  const [contacts, setContacts] = useState<string[]>([]);
  const [contactErr, setContactErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ groupId: string; invited: AddResult[] } | null>(null);

  const add = () => {
    const v = contact.trim();
    if (!CONTACT.test(v)) return setContactErr('Enter a 10-digit mobile number or an email address.');
    if (contacts.includes(v)) return setContactErr('Already added.');
    setContacts([...contacts, v]);
    setContact('');
    setContactErr(null);
  };

  const create = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Give the group a name.');
      const pending = contact.trim() && CONTACT.test(contact.trim()) ? [...contacts, contact.trim()] : contacts;
      return createGroup(name.trim(), type, pending);
    },
    onSuccess: (r) => {
      invalidateMoney();
      const invited = r.members.filter((m) => m.status === 'invited');
      if (invited.length) setResult({ groupId: r.group_id, invited });
      else router.replace(`/group/${r.group_id}`);
    },
  });

  if (result) {
    return (
      <Screen title="Invite your friends" back="close"
        footer={<Button label="Go to group" onPress={() => router.replace(`/group/${result.groupId}`)} />}>
        <T>These people are not on SplitIt yet. They join the group as soon as they sign up from their invite.</T>
        <Card>
          {result.invited.map((m, i) => (
            <Row key={m.contact} first={i === 0}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T lines={1}>{m.contact}</T>
                <T v="caption" color="muted">{m.kind === 'email' ? 'Invite emailed' : 'Send them the link'}</T>
              </View>
              <Button small variant="secondary" label="Share link"
                onPress={() => void shareText(`${profile?.full_name ?? 'A friend'} added you to "${name.trim()}" on SplitIt. Join here: ${inviteLink(m.token!)}`)} />
            </Row>
          ))}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen title="New group" back="close"
      footer={<>
        {!online && <T v="caption" color="muted">Creating a group needs a connection.</T>}
        <Button label="Create group" onPress={() => create.mutate()} loading={create.isPending} disabled={!online} />
      </>}>
      <Field label="Group name" value={name} onChangeText={setName} placeholder="Goa Trip" maxLength={60} />
      <Segmented label="Type" value={type} onChange={setType}
        options={[{ value: 'trip', label: 'Trip' }, { value: 'flat', label: 'Flat' }, { value: 'other', label: 'Other' }]} />
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="Add members" value={contact} onChangeText={setContact} placeholder="Phone number or email"
              autoCapitalize="none" keyboardType="email-address" onSubmitEditing={add} error={contactErr} />
          </View>
          <View style={{ paddingBottom: contactErr ? 22 : 0 }}><Button label="Add" variant="secondary" onPress={add} /></View>
        </View>
        <T v="caption" color="muted">People not on SplitIt yet get an invite link.</T>
      </View>
      <Card>
        <Row first>
          <View style={{ flex: 1 }}><T v="bodyStrong">You</T><T v="caption" color="muted">{profile?.full_name}</T></View>
          <Pill tone="brand">Admin</Pill>
        </Row>
        {contacts.map((ct) => (
          <Row key={ct}>
            <T style={{ flex: 1 }} lines={1}>{ct}</T>
            <IconButton label={`Remove ${ct}`} onPress={() => setContacts(contacts.filter((x) => x !== ct))}><X color={c.muted} size={20} /></IconButton>
          </Row>
        ))}
      </Card>
      {create.error ? <T color="danger">{toAppError(create.error).message === 'Something went wrong. Please try again.' ? (create.error as Error).message : toAppError(create.error).message}</T> : null}
    </Screen>
  );
}
