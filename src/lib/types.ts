export type GroupType = 'trip' | 'flat' | 'other';
export type SplitType = 'equal' | 'exact' | 'percentage' | 'shares';
export interface Profile {
  id: string; full_name: string; phone: string | null; email: string | null; upi_id: string | null; avatar_url: string | null;
  reminder_freq?: 'daily' | 'weekly' | 'off';
}
export interface GroupSummary { id: string; name: string; type: GroupType; member_count: number; my_net: number; is_admin: boolean; last_activity: string | null }
export interface Member { user_id: string; role: 'admin' | 'member'; profile: Profile }
export interface GroupInfo { id: string; name: string; type: GroupType; created_by: string; members: Member[] }
export interface Expense {
  id: string; group_id: string; paid_by: string; total_amount: number; description: string; category: string; expense_date: string;
  split_type: SplitType; split_values: Record<string, number>; receipt_url: string | null; created_by: string; created_at: string; updated_at: string;
  expense_splits: { user_id: string; amount_owed: number }[];
  pending?: boolean;
}
export interface Settlement {
  id: string; group_id: string; from_user: string; to_user: string; amount: number; method: 'upi' | 'cash';
  status: 'pending' | 'marked_paid' | 'completed' | 'declined'; upi_ref: string | null; created_at: string;
  marked_paid_at: string | null; completed_at: string | null;
}
export interface Notification {
  id: string; user_id: string; group_id: string | null; type: string; title: string; body: string; payload: any; read_at: string | null; created_at: string;
}
export interface Invite { id: string; phone: string | null; email: string | null; token: string; created_at: string }
export interface ActivityRow { id: string; group_id: string; kind: string; summary: string; created_at: string; groups: { name: string } | null }

export const CATEGORIES = [
  { key: 'food', label: 'Food & drinks', emoji: '🍽️' },
  { key: 'travel', label: 'Travel', emoji: '🚕' },
  { key: 'stay', label: 'Stay', emoji: '🏨' },
  { key: 'groceries', label: 'Groceries', emoji: '🛒' },
  { key: 'rent', label: 'Rent & bills', emoji: '🏠' },
  { key: 'fun', label: 'Fun', emoji: '🎉' },
  { key: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { key: 'general', label: 'Other', emoji: '🧾' },
] as const;
export const categoryOf = (k: string) => CATEGORIES.find((c) => c.key === k) ?? CATEGORIES[CATEGORIES.length - 1];
export const GROUP_TYPES: { key: GroupType; label: string; emoji: string }[] = [
  { key: 'trip', label: 'Trip', emoji: '🏖️' }, { key: 'flat', label: 'Flat', emoji: '🏠' }, { key: 'other', label: 'Other', emoji: '👥' },
];
