// GENERATED from src/core/phone.ts by scripts/sync-shared.mjs. Do not edit.
/** Indian mobile numbers are stored as "91XXXXXXXXXX" (no plus), the format Supabase Auth uses. */
export function normalizeIndianPhone(input: string): string | null {
  const d = input.replace(/\D/g, '');
  let ten: string;
  if (d.length === 10) ten = d;
  else if (d.length === 11 && d.startsWith('0')) ten = d.slice(1);
  else if (d.length === 12 && d.startsWith('91')) ten = d.slice(2);
  else return null;
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : null;
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return '';
  const ten = p.replace(/^91/, '');
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
