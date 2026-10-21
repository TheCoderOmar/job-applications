// Every date in the app is shown day/month/year.

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-07-26", "2026-07-26 12:00:00" (UTC from SQLite) or an ISO string → a Date. */
export function toDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return new Date(value.replace(' ', 'T') + 'Z');
  return new Date(value);
}

/** 26/07/2026 */
export function dmy(value: string | null | undefined, empty = '—'): string {
  if (!value) return empty;
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** 26/07/2026, 14:20 */
export function dmyTime(value: string | null | undefined, empty = '—'): string {
  if (!value) return empty;
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${dmy(value)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 26/07 (charts, where the year is clear). */
export function dm(value: string): string {
  const d = toDate(value);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** Today as YYYY-MM-DD in local time (what the API stores). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** "26/07/2026" (also 26-7-2026, 26.07.26) → "2026-07-26", or null if it isn't a real date. */
export function parseDmy(text: string): string | null {
  const m = /^\s*(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const [day, month] = [Number(m[1]), Number(m[2])];
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, month - 1, day, 12);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
