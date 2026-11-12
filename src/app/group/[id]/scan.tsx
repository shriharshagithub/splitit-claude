import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { computeBillSplits, formatINR, parseRupees, todayISO } from '@/core';
import { DateField } from '@/components/DateField';
import { Button, Card, Chip, Divider, ErrorBox, Field, InfoBox, Loading, Screen, T } from '@/components/ui';
import { queueSaveExpense, useGroupInfo } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { pickImage } from '@/lib/images';
import { useOnline } from '@/lib/network';
import { callFunction, supabase } from '@/lib/supabase';
import { space, useColors } from '@/lib/theme';

interface Item { key: string; name: string; amount: string; assignees: string[] }
const toText = (p: number) => (p ? (p / 100).toFixed(2) : '');
let n = 0;
const newItem = (name = '', amount = '', assignees: string[] = []): Item => ({ key: `i${n++}`, name, amount, assignees });

export default function Scan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const me = useUserId();
  const online = useOnline();
  const info = useGroupInfo(id);
  const members = info.data?.members ?? [];
  const everyone = members.map((m) => m.user_id);
  const [stage, setStage] = useState<'pick' | 'reading' | 'edit'>('pick');
  const [readNote, setReadNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [tax, setTax] = useState('');
  const [service, setService] = useState('');
  const [discount, setDiscount] = useState('');
  const [printedTotal, setPrintedTotal] = useState<number | null>(null);
  const [desc, setDesc] = useState('Restaurant bill');
  const [date, setDate] = useState(todayISO());
  const [payer, setPayer] = useState(me);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  async function scan(camera: boolean) {
    setError(null);
    if (!online) { setError('Reading a bill needs an internet connection. You can enter the items by hand.'); return; }
    let img;
    try { img = await pickImage({ camera, maxBytes: 950_000, maxSide: 1600 }); } catch (e) { setError(friendlyError(e)); return; }
    if (!img) return;
    setStage('reading');
    try {
      const path = `${id}/${Crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('bills').upload(path, img.bytes, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      setReceipt(path);
      const r = await callFunction<any>('scan-bill', { path });
      if (r.ok) {
        setItems(r.items.map((it: any) => newItem(it.name, toText(it.amount), everyone)));
        setTax(toText(r.tax)); setService(toText(r.service)); setDiscount(toText(r.discount)); setPrintedTotal(r.total ?? null);
        setReadNote({ ok: true, text: `We found ${r.items.length} item${r.items.length === 1 ? '' : 's'}. Check them, fix anything that's wrong, and choose who had what.` });
      } else {
        setItems([newItem('', '', everyone)]);
        setReadNote({ ok: false, text: `${r.reason ?? 'We could not read this bill.'} Type the items below.` });
      }
    } catch (e) {
      setItems([newItem('', '', everyone)]);
      setReadNote({ ok: false, text: `We could not read this bill (${friendlyError(e)}). Type the items below.` });
    }
    setStage('edit');
  }

  function manual() {
    setItems([newItem('', '', everyone)]);
    setReadNote(null);
    setStage('edit');
  }

  const parsed = items.map((it) => ({ name: it.name.trim(), amount: parseRupees(it.amount || '0'), assignees: it.assignees }));
  const badAmount = parsed.some((p) => p.amount === null) || [tax, service, discount].some((v) => v && parseRupees(v) === null);
  const result = useMemo(() => {
    if (badAmount) return { ok: false as const, error: 'Check the amounts: numbers with up to 2 decimals.' };
    return computeBillSplits({
      items: parsed.map((p) => ({ name: p.name, amount: p.amount ?? 0, assignees: p.assignees })),
      tax: parseRupees(tax || '0') ?? 0, service: parseRupees(service || '0') ?? 0, discount: parseRupees(discount || '0') ?? 0, payer,
    });
  }, [JSON.stringify(parsed), tax, service, discount, payer, badAmount]);
  const total = result.ok ? Object.values(result.shares).reduce((a, b) => a + b, 0) : 0;
  const name = (u: string) => (u === me ? 'You' : members.find((m) => m.user_id === u)?.profile.full_name.split(' ')[0] ?? '?');

  async function save() {
    setTried(true);
    if (!result.ok || !desc.trim() || parsed.some((p) => !p.name)) return;
    const shares = result.shares;
    await queueSaveExpense({
      p_id: Crypto.randomUUID(), p_group: id, p_paid_by: payer, p_total: total, p_description: desc.trim(), p_category: 'food', p_date: date,
      p_split_type: 'exact', p_members: Object.keys(shares), p_values: shares,
      p_items: parsed.map((p) => ({ name: p.name, amount: p.amount ?? 0, assignees: p.assignees })), p_receipt_url: receipt,
    });
    router.replace(`/group/${id}`);
  }

  if (!info.data) return <Screen title="Scan a bill">{info.error ? <ErrorBox message={friendlyError(info.error)} /> : <Loading />}</Screen>;

  if (stage === 'pick' || stage === 'reading') {
    return (
      <Screen title="Scan a bill">
        {stage === 'reading' ? (
          <Card style={{ alignItems: 'center' }}><Loading /><T>Reading the bill… this takes a few seconds.</T></Card>
        ) : (
          <>
            <T>Take a photo of a restaurant bill. We read the items, tax and service charge, then you choose who had what.</T>
            <Button title="📷 Take a photo" onPress={() => scan(true)} disabled={!online} />
            <Button title="🖼️ Choose a photo" variant="secondary" onPress={() => scan(false)} disabled={!online} />
            {!online && <InfoBox tone="warn"><T>Reading a bill needs an internet connection. You can still type the items.</T></InfoBox>}
            <Button title="Type the items instead" variant="ghost" onPress={manual} />
            <ErrorBox message={error} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Bill items" footer={
      <View style={{ gap: space(2) }}>
        {tried && !result.ok && <T v="small" color={c.danger}>{result.error}</T>}
        {tried && parsed.some((p) => !p.name) && <T v="small" color={c.danger}>Give every item a name.</T>}
        <Button title={result.ok ? `Save ${formatINR(total)} expense` : 'Save expense'} onPress={save} />
      </View>
    }>
      {readNote && <InfoBox tone={readNote.ok ? 'ok' : 'warn'}><T>{readNote.text}</T></InfoBox>}
      <Field label="Description" value={desc} onChangeText={setDesc} maxLength={100} />
      {items.map((it, i) => (
        <Card key={it.key}>
          <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'flex-end' }}>
            <Field label={`Item ${i + 1}`} value={it.name} onChangeText={(v) => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, name: v } : x)))} style={{ flex: 1 }} placeholder="Paneer tikka" />
            <Field label="₹" value={it.amount} onChangeText={(v) => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, amount: v } : x)))} keyboardType="decimal-pad" style={{ width: 100 }} placeholder="0.00" />
          </View>
          <T v="small">Who had this? (shared equally)</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
            {members.map((m) => (
              <Chip key={m.user_id} label={name(m.user_id)} selected={it.assignees.includes(m.user_id)}
                onPress={() => setItems((s) => s.map((x) => (x.key === it.key ? { ...x, assignees: x.assignees.includes(m.user_id) ? x.assignees.filter((u) => u !== m.user_id) : [...x.assignees, m.user_id] } : x)))} />
            ))}
          </View>
          <Button title="Remove item" variant="ghost" small style={{ alignSelf: 'flex-start' }} onPress={() => setItems((s) => s.filter((x) => x.key !== it.key))} />
        </Card>
      ))}
      <Button title="+ Add item" variant="secondary" onPress={() => setItems((s) => [...s, newItem('', '', everyone)])} />
      <Card>
        <Field label="Tax (GST, CGST + SGST) ₹" value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Service charge ₹" value={service} onChangeText={setService} keyboardType="decimal-pad" placeholder="0.00" />
        <Field label="Discount ₹" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" placeholder="0.00" />
        <T v="small">Tax and service charge are shared in proportion to what each person had. So is the discount.</T>
      </Card>
      <DateField value={date} onChange={setDate} />
      <View style={{ gap: space(1) }}>
        <T v="label">Who paid?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {members.map((m) => <Chip key={m.user_id} label={name(m.user_id)} selected={payer === m.user_id} onPress={() => setPayer(m.user_id)} />)}
        </View>
      </View>
      <Card>
        <T v="h2">Each person pays</T>
        {result.ok ? members.filter((m) => result.shares[m.user_id]).map((m) => (
          <View key={m.user_id} style={{ flexDirection: 'row' }}>
            <T style={{ flex: 1 }}>{name(m.user_id)}</T><T v="money">{formatINR(result.shares[m.user_id])}</T>
          </View>
        )) : <T color={c.owe}>{result.error}</T>}
        <Divider />
        <View style={{ flexDirection: 'row' }}><T style={{ flex: 1, fontWeight: '700' }}>Total</T><T v="money">{formatINR(total)}</T></View>
        {printedTotal !== null && result.ok && Math.abs(printedTotal - total) > 100 && (
          <T v="small" color={c.owe}>The bill says {formatINR(printedTotal)}. Check the items and charges if that's the right total.</T>
        )}
      </Card>
    </Screen>
  );
}
