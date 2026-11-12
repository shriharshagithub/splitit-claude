import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildUpiLink, formatINR, parseRupees } from '@/core';
import { Avatar, Button, Card, ErrorBox, Field, InfoBox, Loading, Screen, Segmented, T } from '@/components/ui';
import { invalidateGroup, keys, useGroupInfo, useSettlements } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { useOnline } from '@/lib/network';
import { backOr, isAndroid } from '@/lib/platform';
import { useLiveGroups } from '@/lib/realtime';
import { copy } from '@/lib/share';
import { supabase } from '@/lib/supabase';
import { space, useColors } from '@/lib/theme';

type Step = 'choose' | 'paying' | 'asked-no' | 'sent';

export default function Settle() {
  const { id, to, amount: amt } = useLocalSearchParams<{ id: string; to: string; amount?: string }>();
  const c = useColors();
  const me = useUserId();
  const qc = useQueryClient();
  const online = useOnline();
  const info = useGroupInfo(id, { fresh: true }); // always re-check the payee's UPI ID
  const settlements = useSettlements(id);
  useLiveGroups([id]);
  const [amount, setAmount] = useState(amt ? (Number(amt) / 100).toFixed(2) : '');
  const [method, setMethod] = useState<'upi' | 'cash'>('upi');
  const [step, setStep] = useState<Step>('choose');
  const [sid, setSid] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const payee = info.data?.members.find((m) => m.user_id === to)?.profile;
  const paise = parseRupees(amount);
  const upiId = payee?.upi_id ?? null;
  const waiting = (settlements.data ?? []).find((s) => s.from_user === me && s.to_user === to && s.status === 'marked_paid');
  const link = upiId && paise && paise > 0 ? buildUpiLink({ upiId, name: payee!.full_name, amount: paise, note: `SplitIt ${info.data?.name ?? ''}` }) : null;
  const android = isAndroid();

  async function start() {
    setError(null);
    if (!online) return setError('Settling up needs an internet connection. Try again when you are back online.');
    if (!paise || paise <= 0) return setError('Enter an amount above ₹0.');
    if (method === 'upi' && !upiId) return setError(`${payee?.full_name ?? 'They'} hasn't added a UPI ID yet. Pay in cash or ask them to add one.`);
    setBusy(true);
    const { data, error: e } = await supabase.rpc('start_settlement', { p_group: id, p_to: to, p_amount: paise, p_method: method });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    setSid(data as string);
    setStep('paying');
    if (method === 'upi' && android && link) {
      // Android shows its chooser of UPI apps (GPay, PhonePe, Paytm, BHIM...).
      if (Platform.OS === 'web') window.location.href = link;
      else Linking.openURL(link).catch(() => setError('No UPI app was found on this phone. Use the QR code on another phone, or pay in cash.'));
    }
  }

  async function markPaid() {
    if (!sid) return;
    setError(null);
    setBusy(true);
    const { error: e } = await supabase.rpc('mark_settlement_paid', { p_id: sid, p_upi_ref: ref.trim() || null });
    setBusy(false);
    if (e) return setError(friendlyError(e));
    invalidateGroup(qc, id);
    qc.invalidateQueries({ queryKey: keys.settlements(id) });
    setStep('sent');
  }

  if (!info.data) return <Screen title="Settle up">{info.error ? <ErrorBox message={friendlyError(info.error)} /> : <Loading />}</Screen>;
  if (!payee) return <Screen title="Settle up"><ErrorBox message="That person is not in this group any more." /></Screen>;

  return (
    <Screen title="Settle up">
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={payee.full_name} url={payee.avatar_url} size={64} />
        <T>You pay <T style={{ fontWeight: '700' }}>{payee.full_name}</T></T>
        <T v="big">{paise ? formatINR(paise) : '₹0.00'}</T>
        <T v="small">for {info.data.name}</T>
      </Card>
      {!online && <InfoBox tone="warn"><T>You are offline. Settling up needs an internet connection.</T></InfoBox>}
      {waiting && step === 'choose' && (
        <InfoBox><T>You already marked {formatINR(Number(waiting.amount))} as paid. Waiting for {payee.full_name} to confirm.</T></InfoBox>
      )}

      {step === 'choose' && (
        <>
          <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" hint="You can pay part of it." />
          <Segmented label="How are you paying?" value={method} onChange={setMethod} options={[{ key: 'upi', label: 'UPI' }, { key: 'cash', label: 'Cash' }]} />
          {method === 'upi' && !upiId && (
            <InfoBox tone="warn">
              <T>Ask {payee.full_name} to add a UPI ID in their SplitIt profile. Until then you can pay in cash.</T>
              <Button title="Pay in cash instead" small variant="teal" style={{ alignSelf: 'flex-start' }} onPress={() => setMethod('cash')} />
            </InfoBox>
          )}
          {method === 'upi' && upiId && <T v="small">Money goes straight from your UPI app to {upiId}. SplitIt never touches it.</T>}
          {method === 'cash' && <T v="small">Hand over the cash, then tell us. {payee.full_name} confirms they got it.</T>}
          <ErrorBox message={error} />
          <Button title={method === 'upi' ? (android ? 'Pay via UPI app' : 'Pay via UPI') : 'I paid in cash'} onPress={start} loading={busy}
            disabled={!online || (method === 'upi' && !upiId)} />
        </>
      )}

      {step === 'paying' && method === 'upi' && link && !android && (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ textAlign: 'center' }}>Scan this with any UPI app (Google Pay, PhonePe, Paytm, BHIM) on your phone:</T>
          <View style={{ padding: space(3), backgroundColor: '#fff', borderRadius: 12 }} accessibilityLabel={`UPI QR code to pay ${formatINR(paise!)} to ${upiId}`}>
            <QRCode value={link} size={220} />
          </View>
          <T v="label">or pay this UPI ID:</T>
          <T v="h2" selectable>{upiId}</T>
          <Button title={copied ? 'Copied ✓' : 'Copy UPI ID'} small variant="secondary" onPress={async () => { await copy(upiId!); setCopied(true); }} />
        </Card>
      )}
      {step === 'paying' && method === 'upi' && android && link && (
        <InfoBox><T>Your UPI app should have opened. Come back here after paying.</T>
          <Button title="Open UPI app again" small variant="secondary" style={{ alignSelf: 'flex-start' }}
            onPress={() => (Platform.OS === 'web' ? (window.location.href = link) : Linking.openURL(link))} /></InfoBox>
      )}

      {step === 'paying' && (
        <Card>
          <T v="h2">{method === 'upi' ? 'Did the payment go through?' : `Did you give ${payee.full_name} the cash?`}</T>
          {method === 'upi' && <Field label="UPI reference number (optional)" value={ref} onChangeText={setRef} keyboardType="number-pad" placeholder="12-digit UTR from your UPI app" maxLength={40} />}
          <ErrorBox message={error} />
          <Button title={method === 'upi' ? 'Yes, I paid' : 'Yes, I gave the cash'} variant="teal" onPress={markPaid} loading={busy} />
          <Button title="No, not yet" variant="secondary" onPress={() => { setStep('asked-no'); setError(null); }} />
        </Card>
      )}

      {step === 'asked-no' && (
        <>
          <InfoBox><T>No problem. Nothing has changed; you still owe {formatINR(paise ?? 0)}. You can try again any time.</T></InfoBox>
          <Button title="Try again" onPress={() => setStep('choose')} />
          <Button title="Back to group" variant="secondary" onPress={() => backOr(`/group/${id}`)} />
        </>
      )}

      {step === 'sent' && (
        <>
          <InfoBox tone="ok">
            <T>Done. We told {payee.full_name} you paid {formatINR(paise!)}{method === 'cash' ? ' in cash' : ''}.</T>
            <T>The debt clears as soon as they confirm. If they say they didn't get it, the debt stays and you can try again.</T>
          </InfoBox>
          <Button title="Back to group" onPress={() => router.replace(`/group/${id}?tab=balances`)} />
        </>
      )}
    </Screen>
  );
}
