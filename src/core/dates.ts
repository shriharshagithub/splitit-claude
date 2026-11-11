/** Calendar dates as 'YYYY-MM-DD' strings in the device's local time (India: IST), never UTC. */
const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const localToday = (now: Date = new Date()) => toIsoDate(now);

export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

const LABEL = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
/** '2026-11-12' -> '12 Nov 2026' */
export const formatDate = (iso: string) => LABEL.format(fromIsoDate(iso));
