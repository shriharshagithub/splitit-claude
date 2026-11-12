// GENERATED from src/core/dates.ts by scripts/sync-shared.mjs. Do not edit.
/** Calendar dates are plain "YYYY-MM-DD" strings in the phone's local time (IST for our users). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

/** "2026-11-03" -> "3 Nov 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** A timestamp shown in IST regardless of the device time zone: "3 Nov 2026, 9:05 pm IST" */
export function formatDateTimeIST(ts: string | Date): string {
  const t = new Date(typeof ts === 'string' ? ts : ts.getTime());
  const ist = new Date(t.getTime() + 330 * 60_000);
  const h = ist.getUTCHours();
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${h12}:${mm} ${h < 12 ? 'am' : 'pm'} IST`;
}

export function monthGrid(year: number, month0: number): (string | null)[] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(year, month0 + 1, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toISODate(new Date(year, month0, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
