import type { SplitType } from '@/core';

export type GroupType = 'trip' | 'flat' | 'other';
export type Role = 'admin' | 'member';

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  upi_id: string | null;
  avatar_url: string | null;
  reminder_frequency?: 'daily' | 'weekly' | 'off';
}

export interface GroupSummary {
  id: string;
  name: string;
  type: GroupType;
  member_count: number;
  my_net: number;
  my_role: Role;
}

export interface Member {
  user_id: string;
  role: Role;
  profile: Profile;
}

export interface Invite {
  id: string;
  contact: string;
  contact_kind: 'phone' | 'email';
  token: string;
  created_at: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  type: GroupType;
  created_by: string;
  members: Member[];
  invites: Invite[];
}

export interface ExpenseRow {
  id: string;
  description: string;
  category: string;
  total_amount: number;
  expense_date: string;
  paid_by: string;
  payer_name: string;
  split_type: SplitType;
  created_by: string;
  created_at: string;
  updated_at: string;
  my_owed: number;
  has_receipt: boolean;
  /** set on rows that only exist in the offline queue */
  pending?: boolean;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_user: string;
  to_user: string;
  amount: number;
  method: 'upi' | 'cash';
  status: 'pending' | 'marked_paid' | 'completed' | 'declined';
  upi_ref: string | null;
  created_at: string;
  marked_paid_at: string | null;
}

export interface Notification {
  id: string;
  group_id: string | null;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ActivityItem {
  id: number;
  group_id: string;
  kind: string;
  summary: string;
  amount: number | null;
  created_at: string;
  group_name?: string;
}

/** Payload of the save_expense database function. */
export interface ExpensePayload {
  id: string;
  group_id: string;
  paid_by: string;
  total_amount: number;
  description: string;
  category: string;
  expense_date: string;
  split_type: SplitType;
  inputs: { user_id: string; value?: number }[];
  receipt_path?: string;
  receipt_items?: { name: string; amount: number; user_ids: string[] }[];
  base_updated_at?: string;
}
