import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, Minus, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Chip } from '@/components/Chip';
import { DateField } from '@/components/DateField';
import { Avatar, Button, Card, ErrorView, Field, Loading, Money, Row, Screen, Segmented, T } from '@/components/ui';
import { computeSplits, formatINR, localToday, parseRupees, type SplitInput, type SplitType } from '@/core';
import { getExpense } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { useGroup } from '@/lib/hooks';
import { deleteExpenseOrQueue, saveExpenseOrQueue, useSync } from '@/lib/offline';
import { invalidateMoney, qk } from '@/lib/query';
import { radius, space, type, useColors } from '@/theme';

const CATEGORIES = [
  ['food', 'Food'], ['travel', 'Travel'], ['stay', 'Stay'], ['groceries', 'Groceries'], ['rent', 'Rent'],
  ['utilities', 'Bills'], ['entertainment', 'Fun'], ['shopping', 'Shopping'], ['general', 'Other'],
] as const;

/** "33.33" -> 3333 basis points; null if invalid. */
function parsePercent(s: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(s.trim() || '0');
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export default function ExpenseScreen() {
  const { id: groupId, expenseId } = useLocalSearchParams<{ id: string; expenseId?: string }>();
  const c = useColors();
  const me = useMe();
  const { outbox } = useSync();
  const group = useGroup(groupId);
  const queued = outbox.find((o) => o.op === 'save_expense' && o.payload.id === expenseId);
  const existing = useQuery({ queryKey: qk.expense(expenseId ?? ''), queryFn: () => getExpense(expenseId!), enabled: !!expenseId && !queued });

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('food');
  const [date, setDate] = useState(localToday());
  const [paidBy, setPaidBy] = useState(me);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [exact, setExact] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const members = group.data?.members ?? [];
  const isAdmin = members.some((m) => m.user_id === me && m.role === 'admin');

  // Fill the form once: defaults for a new expense, or the saved / queued values when editing.
  useEffect(() => {
    if (loaded || !group.data) return;
    const ids = members.map((m) => m.user_id);
    const src = queued?.op === 'save_expense' ? { ...queued.payload, split_inputs: queued.payload.inputs, updated_at: queued.payload.base_updated_at }
      : existing.data ? existing.data : null;
    if (expenseId && !src) return;
    if (src) {
      setAmount((src.total_amount / 100).toFixed(2));
      setDescription(src.description);
      setCategory(src.category);
      setDate(src.expense_date);
      setPaidBy(src.paid_by);
      setSplitType(src.split_type);
      const inp = Object.fromEntries((src.split_inputs ?? []).map((x) => [x.user_id, x.value ?? 0]));
      setIncluded(Object.fromEntries(ids.map((u) => [u, u in inp])));
      if (src.split_type === 'exact') setExact(Object.fromEntries(Object.entries(inp).map(([u, v]) => [u, (v / 100).toFixed(2)])));
      if (src.split_type === 'percentage') setPct(Object.fromEntries(Object.entries(inp).map(([u, v]) => [u, String(v / 100)])));
      if (src.split_type === 'shares') setShares(inp);
    } else {
      setIncluded(Object.fromEntries(ids.map((u) => [u, true])));
      setShares(Object.fromEntries(ids.map((u) => [u, 1])));
    }
    setLoaded(true);
  }, [group.data, existing.data, queued, loaded, expenseId, members]);

  const total = parseRupees(amount);
  const inputs: SplitInput[] | null = useMemo(() => {
    const ids = members.map((m) => m.user_id);
    if (splitType === 'equal') return ids.filter((u) => included[u]).map((userId) => ({ userId }));
    if (splitType === 'exact') {
      const vals = ids.map((u) => ({ userId: u, value: exact[u]?.trim() ? parseRupees(exact[u]) : 0 }));
      return vals.some((v) => v.value === null) ? null : (vals as SplitInput[]);
    }
    if (splitType === 'percentage') {
      const vals = ids.map((u) => ({ userId: u, value: parsePercent(pct[u] ?? '') }));
      return vals.some((v) => v.value === null) ? null : (vals as SplitInput[]);
    }
    return ids.map((u) => ({ userId: u, value: shares[u] ?? 0 }));
  }, [members, splitType, included, exact, pct, shares]);

  const preview = total && total > 0 && inputs ? computeSplits(total, splitType, inputs, paidBy) : null;
  const shareOf = (u: string) => (preview?.ok ? preview.splits.find((s) => s.userId === u)?.amount ?? 0 : null);

  let status: { text: string; bad: boolean } | null = null;
  if (!total) status = { text: 'Enter the amount.', bad: true };
  else if (!inputs) status = { text: splitType === 'exact' ? 'Check the amounts: use numbers like 450 or 450.50.' : 'Check the percentages: numbers up to 2 decimals.', bad: true };
  else if (preview && !preview.ok) {
    if (splitType === 'exact' && preview.allocated !== undefined) {
      const diff = total - preview.allocated;
      status = { text: `Splits add up to ${formatINR(preview.allocated)}. ${diff > 0 ? `Add ${formatINR(diff)} more` : `Remove ${formatINR(-diff)}`} to match the total.`, bad: true };
    } else if (splitType === 'percentage' && preview.allocated !== undefined) {
      status = { text: `Percentages add up to ${(preview.allocated / 100).toFixed(2)}%. They must add up to 100%.`, bad: true };
    } else status = { text: preview.error, bad: true };
  } else if (preview?.ok) status = { text: `Splits add up to ${formatINR(total)}. Any leftover paisa goes to whoever paid.`, bad: false };

  const editing = Boolean(expenseId);
  const createdBy = queued ? me : existing.data?.created_by;
  const canEdit = !editing || createdBy === me || isAdmin;

  const save = async () => {
    setError(null);
    if (!description.trim()) return setError('Add a short description.');
    if (date > localToday()) return setError('The date cannot be in the future.');
    if (!preview?.ok || !total || !inputs) return setError(status?.text ?? 'Check the split.');
    setBusy(true);
    try {
      const payload = {
        id: expenseId ?? Crypto.randomUUID(),
        group_id: groupId, paid_by: paidBy, total_amount: total, description: description.trim(), category, expense_date: date,
        split_type: splitType,
        inputs: inputs.filter((i) => splitType === 'equal' || (i.value ?? 0) > 0).map((i) => ({ user_id: i.userId, ...(splitType === 'equal' ? {} : { value: i.value }) })),
        ...(existing.data ? { base_updated_at: existing.data.updated_at } : {}),
      };
      await saveExpenseOrQueue(payload, description.trim());
      invalidateMoney(groupId);
      router.back();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteExpenseOrQueue(expenseId!, groupId, description);
      invalidateMoney(groupId);
      router.back();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  if (group.isLoading || (editing && !loaded && !existing.error)) return <Screen back="close" title={editing ? 'Expense' : 'Add expense'}><Loading /></Screen>;
  if (group.error && !group.data) return <Screen back="close" title="Add expense"><ErrorView error={group.error} /></Screen>;
  if (existing.error && !queued) return <Screen back="close" title="Expense"><ErrorView error={existing.error} onRetry={() => void existing.refetch()} /></Screen>;

  const ro = !canEdit;
  return (
    <Screen back="close" title={editing ? (ro ? 'Expense' : 'Edit expense') : 'Add expense'} subtitle={group.data?.name}
      footer={ro ? <T v="caption" color="muted">Only the person who added this expense or the group admin can change it.</T> : (
        <View style={{ gap: space[2] }}>
          {error ? <T color="danger">{error}</T> : null}
          <Button label={editing ? 'Save changes' : 'Save expense'} onPress={save} loading={busy} disabled={!preview?.ok} />
        </View>
      )}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Field label="Amount (₹)" amount value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" editable={!ro} />
        </View>
      </View>
      <Field label="Description" value={description} onChangeText={setDescription} placeholder="Dinner at Fisherman's Wharf" maxLength={120} editable={!ro} />
      <View style={{ gap: space[2] }}>
        <T v="label">Category</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {CATEGORIES.map(([v, l]) => <Chip key={v} label={l} on={category === v} onPress={() => !ro && setCategory(v)} />)}
        </View>
      </View>
      <DateField label="Date" value={date} onChange={setDate} editable={!ro} />
      <View style={{ gap: space[2] }}>
        <T v="label">Paid by</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {members.map((m) => <Chip key={m.user_id} label={m.user_id === me ? 'You' : m.profile.full_name.split(' ')[0]} on={paidBy === m.user_id} onPress={() => !ro && setPaidBy(m.user_id)} />)}
        </View>
      </View>
      <Segmented label="Split" value={splitType} onChange={(v) => !ro && setSplitType(v)}
        options={[{ value: 'equal', label: 'Equal' }, { value: 'exact', label: 'Exact' }, { value: 'percentage', label: 'Percent' }, { value: 'shares', label: 'Shares' }]} />

      <View style={{ gap: space[2] }}>
        <Card>
          {members.map((m, i) => {
            const u = m.user_id;
            const amt = shareOf(u);
            return (
              <Row key={u} first={i === 0}>
                <Avatar name={m.profile.full_name} size={32} />
                <T style={{ flex: 1, minWidth: 0 }} lines={1}>{u === me ? 'You' : m.profile.full_name.split(' ')[0]}</T>
                {splitType === 'equal' && (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!included[u] }} accessibilityLabel={`Include ${m.profile.full_name}`}
                    onPress={() => !ro && setIncluded({ ...included, [u]: !included[u] })}
                    style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 1.5, borderColor: included[u] ? c.brand : c.lineStrong, backgroundColor: included[u] ? c.brand : c.surface, alignItems: 'center', justifyContent: 'center' }}>
                    {included[u] ? <Check size={18} color={c.onBrand} strokeWidth={2.5} /> : null}
                  </Pressable>
                )}
                {(splitType === 'exact' || splitType === 'percentage') && (
                  <TextInput
                    accessibilityLabel={`${splitType === 'exact' ? 'Amount' : 'Percent'} for ${m.profile.full_name}`}
                    value={splitType === 'exact' ? exact[u] ?? '' : pct[u] ?? ''}
                    onChangeText={(t) => (splitType === 'exact' ? setExact({ ...exact, [u]: t }) : setPct({ ...pct, [u]: t }))}
                    keyboardType="decimal-pad" placeholder={splitType === 'exact' ? '0.00' : '0'} placeholderTextColor={c.muted} editable={!ro}
                    style={[type.amount, { width: 88, minHeight: 40, textAlign: 'right', borderWidth: 1, borderColor: c.lineStrong, borderRadius: radius.sm, paddingHorizontal: space[2], color: c.ink, backgroundColor: c.surface }]} />
                )}
                {splitType === 'percentage' && <T v="label" color="muted">%</T>}
                {splitType === 'shares' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`One less share for ${m.profile.full_name}`} disabled={ro}
                      onPress={() => setShares({ ...shares, [u]: Math.max(0, (shares[u] ?? 0) - 1) })}
                      style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      <Minus size={16} color={c.brand} />
                    </Pressable>
                    <T v="amount" style={{ width: 28, textAlign: 'center' }}>{String(shares[u] ?? 0)}</T>
                    <Pressable accessibilityRole="button" accessibilityLabel={`One more share for ${m.profile.full_name}`} disabled={ro}
                      onPress={() => setShares({ ...shares, [u]: (shares[u] ?? 0) + 1 })}
                      style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: c.lineStrong, alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={16} color={c.brand} />
                    </Pressable>
                  </View>
                )}
                <View style={{ width: 96, alignItems: 'flex-end' }}>
                  {amt ? <Money paise={amt} /> : <T v="caption" color="muted">{amt === 0 ? 'not in split' : '—'}</T>}
                </View>
              </Row>
            );
          })}
        </Card>
        {status ? <T v="caption" color={status.bad ? 'danger' : 'muted'} accessibilityLiveRegion="polite">{status.text}</T> : null}
      </View>

      {editing && canEdit && (
        confirmDelete ? (
          <Card style={{ padding: space[4], gap: space[3] }}>
            <T>Delete this expense? Balances will be recalculated.</T>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <Button style={{ flex: 1 }} variant="secondary" label="Keep it" onPress={() => setConfirmDelete(false)} />
              <Button style={{ flex: 1 }} variant="danger" label="Delete" onPress={remove} loading={busy} />
            </View>
          </Card>
        ) : <Button variant="quiet" label="Delete expense" onPress={() => setConfirmDelete(true)} />
      )}
    </Screen>
  );
}
