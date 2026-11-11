import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, ShieldCheck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Avatar, Button, Card, ErrorView, Field, Loading, Money, Pill, Row, Screen, Sheet, T } from '@/components/ui';
import { buildUpiLink, formatINR } from '@/core';
import { markPaid, startSettlement } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useGroup, useOpenSettlements, useTransfers } from '@/lib/hooks';
import { useSync } from '@/lib/offline';
import { invalidateMoney } from '@/lib/query';
import { radius, space, useColors } from '@/theme';

type Stage = 'choose' | 'qr' | 'ask' | 'cash' | 'done';

export default function SettleUp() {
  const { id: groupId, userId: to } = useLocalSearchParams<{ id: string; userId: string }>();
  const c = useColors();
  const me = useMe();
  const { online } = useSync();
  const group = useGroup(groupId);
  const { transfers, isLoading } = useTransfers(groupId);
  const settlements = useOpenSettlements(groupId);
  const [stage, setStage] = useState<Stage>('choose');
  const [sid, setSid] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const launched = useRef(false);

  // When the person comes back from their UPI app, ask whether the payment went through.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && launched.current) {
        launched.current = false;
        setStage('ask');
      }
    });
    return () => sub.remove();
  }, []);

  const creditor = group.data?.members.find((m) => m.user_id === to)?.profile;
  const debt = transfers?.find((t) => t.from === me && t.to === to);
  const claim = settlements.data?.find((s) => s.from_user === me && s.to_user === to && s.status === 'marked_paid');
  const first = creditor?.full_name.split(' ')[0] ?? 'them';
  const amount = debt?.amount ?? 0;

  const begin = async (method: 'upi' | 'cash') => {
    setError(null);
    if (!online) return setError('Settling up needs a connection. Try again when you are back online.');
    setBusy(true);
    try {
      const r = await startSettlement(groupId, to, amount, method);
      setSid(r.id);
      if (method === 'cash') return setStage('cash');
      const link = buildUpiLink({ upiId: r.upi_id!, name: r.name, amount, groupName: group.data!.name });
      if (Platform.OS === 'android') {
        const can = await Linking.canOpenURL(link).catch(() => false);
        if (!can) {
          setError('No UPI app was found on this phone. Scan the QR code from another phone, or pay the UPI ID directly.');
          return setStage('qr');
        }
        launched.current = true;
        await Linking.openURL(link); // Android shows the UPI app chooser
      } else {
        setStage('qr'); // iPhone and computers: no UPI chooser, so show a QR code and the UPI ID
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmPaid = async () => {
    if (!sid) return;
    setBusy(true);
    setError(null);
    try {
      await markPaid(sid, ref.trim() || null);
      invalidateMoney(groupId);
      setStage('done');
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (group.isLoading || isLoading) return <Screen back title="Settle up"><Loading /></Screen>;
  if (group.error && !group.data) return <Screen back title="Settle up"><ErrorView error={group.error} /></Screen>;

  if (stage === 'done' || claim) {
    return (
      <Screen back title="Settle up" subtitle={group.data?.name} footer={<Button label="Done" onPress={() => router.back()} />}>
        <Pill tone="pending">Waiting for {first} to confirm</Pill>
        <T v="title">Marked as paid</T>
        <T color="muted">We have told {first} by email and in the app. Your balance changes when {first} confirms. If there is no answer in 3 days, we send {first} a reminder.</T>
      </Screen>
    );
  }
  if (!debt) {
    return (
      <Screen back title="Settle up" subtitle={group.data?.name}>
        <T>You do not owe {first} anything in this group right now.</T>
        <Button variant="secondary" label="Back to group" onPress={() => router.back()} />
      </Screen>
    );
  }

  const link = creditor?.upi_id ? buildUpiLink({ upiId: creditor.upi_id, name: creditor.full_name, amount, groupName: group.data!.name }) : null;

  return (
    <Screen back title="Settle up" subtitle={group.data?.name}
      footer={stage === 'qr' ? (
        <Button label="I have paid" onPress={() => setStage('ask')} />
      ) : (
        <View style={{ gap: space[3] }}>
          {error ? <T color="danger">{error}</T> : null}
          {!online ? <T v="caption" color="muted">Settling up needs a connection.</T> : null}
          <Button variant="upi" label={`Pay ${formatINR(amount)} via UPI`} onPress={() => begin('upi')} loading={busy} disabled={!creditor?.upi_id || !online} />
          {!creditor?.upi_id ? <T v="caption" color="muted">Ask {first} to add a UPI ID in their profile. You can still settle in cash.</T> : null}
          <Button variant="secondary" label="I paid in cash" onPress={() => begin('cash')} disabled={busy || !online} />
        </View>
      )}>
      <Card style={{ padding: space[6], alignItems: 'center', gap: space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <Avatar name={group.data?.members.find((m) => m.user_id === me)?.profile.full_name ?? 'You'} size={48} />
          <ArrowRight color={c.muted} size={28} />
          <Avatar name={creditor?.full_name ?? '?'} uri={creditor?.avatar_url} size={48} />
        </View>
        <T>You pay <T v="bodyStrong">{creditor?.full_name}</T></T>
        <Money paise={amount} v="amountXl" color="negative" />
      </Card>

      {stage === 'qr' && link ? (
        <Card style={{ padding: space[4], alignItems: 'center', gap: space[3], borderRadius: radius.lg }}>
          <View style={{ padding: space[3], backgroundColor: '#ffffff', borderRadius: radius.sm }}>
            <QRCode value={link} size={200} backgroundColor="#ffffff" color="#15163a" />
          </View>
          <T center color="muted">Scan with any UPI app on another phone, or open your UPI app and pay the UPI ID below.</T>
          {error ? <T color="danger">{error}</T> : null}
        </Card>
      ) : null}

      <Card>
        <Row first>
          <View style={{ flex: 1 }}><T v="label" color="muted">To UPI ID</T><T v="amount" selectable lines={1}>{creditor?.upi_id ?? 'Not added yet'}</T></View>
          {creditor?.upi_id ? (
            <Button small variant="secondary" label={copied ? 'Copied' : 'Copy'} onPress={async () => {
              await Clipboard.setStringAsync(creditor.upi_id!).catch(() => undefined);
              setCopied(true);
            }} />
          ) : null}
        </Row>
        <Row><T v="label" color="muted" style={{ flex: 1 }}>Payment note</T><T v="label">SplitIt {group.data?.name}</T></Row>
      </Card>

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <ShieldCheck color={c.muted} size={18} />
        <T v="caption" color="muted" style={{ flex: 1 }}>The money goes straight from your bank to {first}&apos;s. SplitIt never holds it. The debt clears once {first} confirms the money arrived.</T>
      </View>

      <Sheet visible={stage === 'ask'} onClose={() => setStage('choose')} title="Did the payment go through?">
        <T color="muted">You were paying {first} {formatINR(amount)} for {group.data?.name}.</T>
        <Field label="UPI reference number (optional)" value={ref} onChangeText={setRef} keyboardType="number-pad" maxLength={35}
          help="The 12-digit number on your UPI app's receipt. It helps them find the payment." />
        {error ? <T color="danger">{error}</T> : null}
        <Button label="Yes, mark as paid" onPress={confirmPaid} loading={busy} />
        <Button variant="secondary" label="No, it did not go through" onPress={() => setStage('choose')} />
        <T v="caption" color="muted" center>If you choose No, nothing changes and you can try again.</T>
      </Sheet>

      <Sheet visible={stage === 'cash'} onClose={() => setStage('choose')} title="Paid in cash?">
        <T color="muted">Mark {formatINR(amount)} to {first} as paid in cash. {first} confirms before the debt clears.</T>
        {error ? <T color="danger">{error}</T> : null}
        <Button label="Yes, I paid in cash" onPress={confirmPaid} loading={busy} />
        <Button variant="secondary" label="Cancel" onPress={() => setStage('choose')} />
      </Sheet>
    </Screen>
  );
}
