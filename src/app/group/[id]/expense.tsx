import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Alert, View } from 'react-native';
import { computeSplits, formatINR, parseRupees, todayISO, type SplitType } from '@/core';
import { DateField } from '@/components/DateField';
import { Avatar, Button, Card, Chip, ErrorBox, Field, InfoBox, Loading, Screen, Segmented, T } from '@/components/ui';
import { queueDeleteExpense, queueSaveExpense, useExpenses, useGroupInfo, usePendingExpenses } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { backOr } from '@/lib/platform';
import { space, useColors } from '@/lib/theme';
import { CATEGORIES, type Expense } from '@/lib/types';

const TYPES: { key: SplitType; label: string }[] = [
  { key: 'equal', label: 'Equally' }, { key: 'exact', label: 'Amounts' }, { key: 'percentage', label: '%' }, { key: 'shares', label: 'Shares' },
];

/** Typed text for each person -> the integer values the split rules use. */
function toValues(type: SplitType, raw: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (type === 'exact') out[k] = parseRupees(v || '0') ?? NaN;
    else if (type === 'percentage') out[k] = parseRupees(v || '0') ?? NaN; // "12.5" % -> 1250 basis points (same 2-decimal parsing)
    else if (type === 'shares') out[k] = /^\d+$/.test(v || '0') ? Number(v || '0') : NaN;
  }
  return out;
}
function fromValues(type: SplitType, vals: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vals)) {
    out[k] = type === 'shares' ? String(v) : (v / 100).toFixed(2).replace(/\.00$/, '');
  }
  return out;
}

function confirmAsk(text: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(text));
  return new Promise((res) => Alert.alert(text, undefined, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: 'Delete', style: 'destructive', onPress: () => res(true) }]));
}

export default function ExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExpenseForm groupId={id} />;
}

function ExpenseForm({ groupId }: { groupId: string }) {
  const search = useLocalSearchParams<{ id: string; eid?: string }>();
  // the expense id comes in as ?eid=... (the route's own [id] is the group)
  const editId = search.eid;
  const c = useColors();
  const me = useUserId();
    const info = useGroupInfo(groupId);
  const expenses = useExpenses(groupId);
  const { saves } = usePendingExpenses(groupId);
  const existing: Expense | undefined = editId ? saves.find((e) => e.id === editId) ?? expenses.data?.pages.flat().find((e) => e.id === editId) : undefined;
  const members = info.data?.members ?? [];
  const isAdmin = members.find((m) => m.user_id === me)?.role === 'admin';
  const canEdit = !existing || existing.pending || existing.created_by === me || isAdmin;

  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState('food');
  const [date, setDate] = useState(todayISO());
  const [payer, setPayer] = useState(me);
  const [type, setType] = useState<SplitType>('equal');
  const [included, setIncluded] = useState<string[]>([]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !info.data) return;
    if (editId && !existing) return; // wait for data
    if (existing) {
      setAmount((Number(existing.total_amount) / 100).toFixed(2).replace(/\.00$/, ''));
      setDesc(existing.description); setCategory(existing.category); setDate(existing.expense_date); setPayer(existing.paid_by);
      setType(existing.split_type);
      setIncluded(existing.split_type === 'equal' ? existing.expense_splits.map((s) => s.user_id) : members.map((m) => m.user_id));
      setRaw(existing.split_type === 'equal' ? {} : fromValues(existing.split_type, existing.split_values ?? {}));
    } else {
      setIncluded(members.map((m) => m.user_id));
    }
    setLoaded(true);
  }, [info.data, existing, editId, loaded, members]);

  const total = parseRupees(amount);
  const memberIds = type === 'equal' ? members.map((m) => m.user_id).filter((u) => included.includes(u)) : members.map((m) => m.user_id);
  const values = toValues(type, raw);
  const preview = useMemo(() => {
    if (total === null || total <= 0) return { ok: false as const, error: 'Enter the amount.' };
    if (Object.values(values).some((v) => Number.isNaN(v))) return { ok: false as const, error: type === 'shares' ? 'Shares must be whole numbers.' : 'Check the numbers; use up to 2 decimals.' };
    return computeSplits({ total, payer, type, members: memberIds, values });
  }, [total, payer, type, memberIds.join(','), JSON.stringify(values)]);

  const typedSum = Object.values(values).filter((v) => !Number.isNaN(v)).reduce((a, b) => a + b, 0);
  const helper = type === 'exact' ? `${formatINR(typedSum)} of ${formatINR(total ?? 0)} assigned`
    : type === 'percentage' ? `${(typedSum / 100).toFixed(2).replace(/\.00$/, '')}% of 100% assigned`
    : type === 'shares' ? `${typedSum} share${typedSum === 1 ? '' : 's'} in total` : `${memberIds.length} ${memberIds.length === 1 ? 'person' : 'people'}`;

  async function save() {
    setTried(true);
    if (!desc.trim() || !preview.ok || !total) return;
    setBusy(true);
    const p_values = type === 'equal' ? {} : Object.fromEntries(memberIds.map((u) => [u, values[u] ?? 0]));
    await queueSaveExpense({
      p_id: existing?.id ?? Crypto.randomUUID(), p_group: groupId, p_paid_by: payer, p_total: total, p_description: desc.trim(), p_category: category,
      p_date: date, p_split_type: type, p_members: type === 'equal' ? memberIds : memberIds.filter((u) => (p_values as any)[u] > 0 || type === 'exact'),
      p_values, p_base_updated_at: existing && !existing.pending ? existing.updated_at : null,
    });
    setBusy(false);
    backOr(`/group/${groupId}`);
  }

  async function remove() {
    if (!existing || !(await confirmAsk(`Delete "${existing.description}"?`))) return;
    await queueDeleteExpense(groupId, existing.id);
    backOr(`/group/${groupId}`);
  }

  if (!info.data || (editId && !existing && !loaded)) return <Screen title="Expense">{expenses.isLoading || info.isLoading ? <Loading /> : <ErrorBox message="This expense could not be found. It may have been deleted." />}</Screen>;
  const name = (u: string) => (u === me ? 'You' : members.find((m) => m.user_id === u)?.profile.full_name ?? 'Someone');

  return (
    <Screen title={existing ? (canEdit ? 'Edit expense' : 'Expense') : 'Add expense'}
      footer={canEdit ? (
        <View style={{ gap: space(2) }}>
          {tried && !preview.ok && <T v="small" color={c.danger}>{preview.error}</T>}
          {tried && !desc.trim() && <T v="small" color={c.danger}>Add a short description.</T>}
          <Button title={existing ? 'Save changes' : 'Save expense'} onPress={save} loading={busy} />
        </View>
      ) : undefined}>
      {!canEdit && <InfoBox><T>Only the person who added this expense or the group admin can change it.</T></InfoBox>}
      <Field label="Amount (₹)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" editable={canEdit}
        error={tried && (total === null || total <= 0) ? 'Enter an amount above ₹0, with up to 2 decimals.' : null} />
      <Field label="Description" value={desc} onChangeText={setDesc} placeholder="Dinner at Fisherman's Wharf" maxLength={100} editable={canEdit}
        error={tried && !desc.trim() ? 'Add a short description.' : null} />
      <View style={{ gap: space(1) }}>
        <T v="label">Category</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {CATEGORIES.map((k) => <Chip key={k.key} label={`${k.emoji} ${k.label}`} selected={category === k.key} onPress={() => canEdit && setCategory(k.key)} />)}
        </View>
      </View>
      <DateField value={date} onChange={(d) => canEdit && setDate(d)} />
      <View style={{ gap: space(1) }}>
        <T v="label">Who paid?</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {members.map((m) => <Chip key={m.user_id} label={name(m.user_id)} selected={payer === m.user_id} onPress={() => canEdit && setPayer(m.user_id)} />)}
        </View>
      </View>
      <View style={{ gap: space(2) }}>
        <T v="label">Split</T>
        <Segmented label="Split type" value={type} onChange={(t) => { if (!canEdit) return; setType(t); setRaw(t === 'shares' ? Object.fromEntries(members.map((m) => [m.user_id, '1'])) : {}); }} options={TYPES} />
        <T v="small">{helper}</T>
      </View>
      <Card>
        {members.map((m) => {
          const share = preview.ok ? preview.shares[m.user_id] ?? 0 : null;
          return (
            <View key={m.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 52 }}>
              {type === 'equal' ? (
                <Chip label={name(m.user_id)} selected={included.includes(m.user_id)}
                  onPress={() => canEdit && setIncluded((s) => (s.includes(m.user_id) ? s.filter((x) => x !== m.user_id) : [...s, m.user_id]))} />
              ) : (
                <>
                  <Avatar name={m.profile.full_name} url={m.profile.avatar_url} size={32} />
                  <T style={{ flex: 1 }} numberOfLines={1}>{name(m.user_id)}</T>
                  <Field label={`${name(m.user_id)} ${type === 'exact' ? 'amount' : type === 'percentage' ? 'percent' : 'shares'}`} value={raw[m.user_id] ?? ''}
                    onChangeText={(v) => setRaw((r) => ({ ...r, [m.user_id]: v }))} keyboardType={type === 'shares' ? 'number-pad' : 'decimal-pad'}
                    placeholder={type === 'exact' ? '₹0' : type === 'percentage' ? '0 %' : '0'} style={{ width: 96 }} editable={canEdit} />
                </>
              )}
              <View style={{ flex: type === 'equal' ? 1 : undefined, alignItems: 'flex-end', minWidth: 96 }}>
                <T v="money" color={share ? c.text : c.muted}>{share === null ? '–' : formatINR(share)}</T>
              </View>
            </View>
          );
        })}
        {preview.ok
          ? <T v="small" color={c.owed}>✓ Adds up to {formatINR(total!)}. Any leftover paise go to {name(payer)}.</T>
          : <T v="small" color={c.owe}>{preview.error}</T>}
      </Card>
      {existing && canEdit && <Button title="Delete expense" variant="danger" onPress={remove} />}
    </Screen>
  );
}
