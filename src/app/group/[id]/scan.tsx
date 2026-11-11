import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ImagePlus, Plus, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { Chip } from '@/components/Chip';
import { Button, Card, Field, IconButton, Loading, Money, Screen, T } from '@/components/ui';
import { computeReceiptSplits, formatINR, localToday, parseRupees } from '@/core';
import { saveExpense, scanBill } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useGroup } from '@/lib/hooks';
import { useSync } from '@/lib/offline';
import { invalidateMoney } from '@/lib/query';
import { radius, space, type, useColors } from '@/theme';

interface Item { key: string; name: string; amount: string; users: string[] }
const rupees = (p: number) => (p / 100).toFixed(2);

export default function ScanBill() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const me = useMe();
  const { online } = useSync();
  const group = useGroup(groupId);
  const members = group.data?.members ?? [];
  const firstName = (u: string) => (u === me ? 'You' : members.find((m) => m.user_id === u)?.profile.full_name.split(' ')[0] ?? '?');

  const [stage, setStage] = useState<'pick' | 'reading' | 'review'>('pick');
  const [note, setNote] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | undefined>();
  const [items, setItems] = useState<Item[]>([]);
  const [tax, setTax] = useState('0.00');
  const [service, setService] = useState('0.00');
  const [discount, setDiscount] = useState('0.00');
  const [printedTotal, setPrintedTotal] = useState<number | null>(null);
  const [description, setDescription] = useState('Restaurant bill');
  const [paidBy, setPaidBy] = useState(me);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const newItem = (name = '', amount = '', users: string[] = []): Item => ({ key: Crypto.randomUUID(), name, amount, users });

  const pick = async (camera: boolean) => {
    setError(null);
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setError('Allow camera access in Settings, or choose a photo instead.');
      }
      const res = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (res.canceled || !res.assets[0]) return;
      setStage('reading');
      // Shrink to keep the upload small and under the free OCR size limit.
      const ref = await ImageManipulator.manipulate(res.assets[0].uri).resize({ width: 1400 }).renderAsync();
      const img = await ref.saveAsync({ compress: 0.6, format: SaveFormat.JPEG });
      const file = Platform.OS === 'web'
        ? await (await fetch(img.uri)).blob()
        : { uri: img.uri, name: 'bill.jpg', type: 'image/jpeg' };
      const r = await scanBill(groupId, file);
      setReceiptPath(r.receipt_path);
      const everyone = members.map((m) => m.user_id);
      setItems(r.items.length ? r.items.map((it) => newItem(it.name, rupees(it.amount), everyone)) : [newItem('', '', everyone)]);
      setTax(rupees(r.tax));
      setService(rupees(r.service_charge));
      setDiscount(rupees(r.discount));
      setPrintedTotal(r.printed_total);
      setNote(r.ocr_ok ? `Read ${r.items.length} items. Check each line and fix anything that looks wrong.` : r.message);
      setStage('review');
    } catch (e) {
      setError(`${errText(e)} You can enter the items by hand instead.`);
      setStage('pick');
    }
  };

  const manual = () => {
    setItems([newItem('', '', members.map((m) => m.user_id))]);
    setNote('Type in each item from the bill and who had it.');
    setStage('review');
  };

  const parsed = useMemo(() => {
    const its = items.map((i) => ({ amount: parseRupees(i.amount), assignees: i.users, name: i.name.trim() }));
    const t = parseRupees(tax), s = parseRupees(service), d = parseRupees(discount);
    if (its.some((i) => i.amount === null) || t === null || s === null || d === null) return { error: 'Check the amounts: use numbers like 120 or 120.50.' };
    const extras = (t as number) + (s as number) - (d as number);
    const r = computeReceiptSplits(its as { amount: number; assignees: string[] }[], extras, paidBy);
    if (!r.ok) return { error: r.error };
    const itemsTotal = its.reduce((a, i) => a + (i.amount as number), 0);
    return { splits: r.splits, total: itemsTotal + extras, itemsTotal, its };
  }, [items, tax, service, discount, paidBy]);

  const save = async () => {
    setError(null);
    if (!('splits' in parsed) || !parsed.splits) return setError(parsed.error ?? 'Check the bill.');
    if (parsed.its!.some((i) => !i.name)) return setError('Give every item a name.');
    if (!description.trim()) return setError('Add a short description.');
    setBusy(true);
    try {
      await saveExpense({
        id: Crypto.randomUUID(), group_id: groupId, paid_by: paidBy, total_amount: parsed.total!, description: description.trim(),
        category: 'food', expense_date: localToday(), split_type: 'exact',
        inputs: parsed.splits.map((s) => ({ user_id: s.userId, value: s.amount })),
        receipt_path: receiptPath,
        receipt_items: parsed.its!.map((i) => ({ name: i.name, amount: i.amount as number, user_ids: i.assignees })),
      });
      invalidateMoney(groupId);
      router.back();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<Item>) => setItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const smallInput = [type.amount, { width: 96, minHeight: 40, textAlign: 'right' as const, borderWidth: 1, borderColor: c.lineStrong, borderRadius: radius.sm, paddingHorizontal: space[2], color: c.ink, backgroundColor: c.surface }];

  if (group.isLoading) return <Screen back="close" title="Scan bill"><Loading /></Screen>;

  if (stage !== 'review') {
    return (
      <Screen back="close" title="Scan bill" subtitle={group.data?.name}>
        <T>Take a photo of a restaurant bill. We read the items and amounts, then you choose who had what. Tax and service charge are shared in proportion to what each person ordered.</T>
        {stage === 'reading' ? <Card style={{ padding: space[4] }}><T>Reading your bill…</T></Card> : (
          <View style={{ gap: space[3] }}>
            {!online && <T color="muted">Scanning needs a connection. You can still add the items by hand.</T>}
            {Platform.OS !== 'web' && <Button label="Take a photo" icon={<Camera size={20} color={c.onBrand} />} onPress={() => pick(true)} disabled={!online} />}
            <Button variant={Platform.OS === 'web' ? 'primary' : 'secondary'} label="Choose a photo" icon={<ImagePlus size={20} color={Platform.OS === 'web' ? c.onBrand : c.brand} />} onPress={() => pick(false)} disabled={!online} />
            <Button variant="quiet" label="Enter items by hand" onPress={manual} />
          </View>
        )}
        {error ? <T color="danger">{error}</T> : null}
        <T v="caption" color="muted">JPEG or PNG, up to 10 MB.</T>
      </Screen>
    );
  }

  return (
    <Screen back="close" title="Check the bill" subtitle={group.data?.name}
      footer={<View style={{ gap: space[2] }}>
        {error ? <T color="danger">{error}</T> : null}
        <Button label={'total' in parsed && parsed.total ? `Create expense for ${formatINR(parsed.total)}` : 'Create expense'} onPress={save} loading={busy} disabled={!('splits' in parsed) || !online} />
      </View>}>
      {note ? <T color="muted">{note}</T> : null}
      <Field label="Description" value={description} onChangeText={setDescription} maxLength={120} />
      <View style={{ gap: space[2] }}>
        <T v="label">Paid by</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {members.map((m) => <Chip key={m.user_id} label={firstName(m.user_id)} on={paidBy === m.user_id} onPress={() => setPaidBy(m.user_id)} />)}
        </View>
      </View>
      <View style={{ gap: space[3] }}>
        {items.map((it, idx) => (
          <Card key={it.key} style={{ padding: space[3], gap: space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <TextInput accessibilityLabel={`Item ${idx + 1} name`} value={it.name} onChangeText={(t) => update(it.key, { name: t })} placeholder="Item name"
                placeholderTextColor={c.muted} style={[type.body, { flex: 1, minWidth: 0, minHeight: 40, color: c.ink, borderBottomWidth: 1, borderBottomColor: c.lineStrong }]} />
              <TextInput accessibilityLabel={`Item ${idx + 1} amount`} value={it.amount} onChangeText={(t) => update(it.key, { amount: t })} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.muted} style={smallInput} />
              <IconButton label={`Remove item ${idx + 1}`} onPress={() => setItems(items.filter((x) => x.key !== it.key))}><Trash2 size={20} color={c.muted} /></IconButton>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {members.map((m) => (
                <Chip key={m.user_id} label={firstName(m.user_id)} on={it.users.includes(m.user_id)}
                  onPress={() => update(it.key, { users: it.users.includes(m.user_id) ? it.users.filter((u) => u !== m.user_id) : [...it.users, m.user_id] })} />
              ))}
            </View>
          </Card>
        ))}
        <Button variant="secondary" small label="Add item" icon={<Plus size={18} color={c.brand} />} onPress={() => setItems([...items, newItem('', '', members.map((m) => m.user_id))])} />
      </View>
      <Card style={{ padding: space[4], gap: space[2] }}>
        {[['Tax (GST)', tax, setTax], ['Service charge', service, setService], ['Discount', discount, setDiscount]].map(([label, val, set]) => (
          <View key={label as string} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="label">{label as string}</T>
            <TextInput accessibilityLabel={label as string} value={val as string} onChangeText={set as (t: string) => void} keyboardType="decimal-pad" style={smallInput} />
          </View>
        ))}
        {'total' in parsed && parsed.total ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: space[2] }}>
            <T v="bodyStrong">Bill total</T><Money paise={parsed.total} v="amountLg" />
          </View>
        ) : null}
        {printedTotal && 'total' in parsed && parsed.total && Math.abs(printedTotal - parsed.total) > 100 ? (
          <T v="caption" color="pending">The bill says {formatINR(printedTotal)}. Check for a missed item or charge.</T>
        ) : null}
      </Card>
      {'splits' in parsed && parsed.splits ? (
        <View style={{ gap: space[2] }}>
          <T v="label">Each person pays</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {parsed.splits.map((s) => (
              <View key={s.userId} style={{ flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] }}>
                <T v="label">{firstName(s.userId)}</T><Money paise={s.amount} v="amountSm" />
              </View>
            ))}
          </View>
        </View>
      ) : <T color="danger">{'error' in parsed ? parsed.error : ''}</T>}
    </Screen>
  );
}
