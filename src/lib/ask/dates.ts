/**
 * Calendar-date helpers for the expiry check. Everything works on plain
 * year/month/day integers ("date-only"), never on Date instants, so the result
 * cannot shift by a day because of time zones or daylight saving. The only Date
 * use is reading the UTC calendar fields of a timestamp in `serverToday`.
 */

export interface DateOnly {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/** Printed expiry dates are expected in this window; anything else is treated as unreadable. */
export const MIN_PLAUSIBLE_YEAR = 2000;
export const MAX_PLAUSIBLE_YEAR = 2099;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function isValidDate(year: number, month: number, day: number): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  );
}

/** Sortable integer: 2027-08-31 -> 20270831. */
export function dateKey(d: DateOnly): number {
  return d.year * 10000 + d.month * 100 + d.day;
}

export function compareDates(a: DateOnly, b: DateOnly): -1 | 0 | 1 {
  const x = dateKey(a);
  const y = dateKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function lastDayOfMonth(year: number, month: number): DateOnly {
  return { year, month, day: daysInMonth(year, month) };
}

export function formatIso(d: DateOnly): string {
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(d.year, 4)}-${p(d.month, 2)}-${p(d.day, 2)}`;
}

/** "6 November 2026". */
export function formatDate(d: DateOnly): string {
  return `${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}`;
}

/** "November 2026". */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Strict "YYYY-MM-DD" -> DateOnly, or null when malformed or not a real date. */
export function parseIsoDate(text: unknown): DateOnly | null {
  if (typeof text !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return isValidDate(year, month, day) ? { year, month, day } : null;
}

function dayNumber(d: DateOnly): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

/**
 * The calendar date on the user's own device (local time zone), as YYYY-MM-DD.
 * Deliberately uses the local getters: it is the user's "today" that matters.
 */
export function toLocalIsoDate(now: Date): string {
  return formatIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export type TodaySource = "device" | "server";

/** How far (in days) a device-reported date may differ from the server's UTC date. */
export const MAX_DEVICE_DATE_SKEW_DAYS = 2;

/**
 * The calendar date to compare against. Prefers the date reported by the
 * user's device (their local "today", which is the one that matters near
 * midnight) when it is a real date within ±2 days of the server's UTC date
 * (time zones differ by at most one day; the rest is slack for clock drift). A
 * wildly different value is ignored, so a wrong device clock or a crafted
 * request cannot move "today" far.
 */
export function resolveToday(
  deviceDate: string | null | undefined,
  nowMs: number,
): { date: DateOnly; source: TodaySource } {
  const instant = new Date(nowMs);
  const server: DateOnly = {
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
  };
  const device = parseIsoDate(deviceDate);
  if (device && Math.abs(dayNumber(device) - dayNumber(server)) <= MAX_DEVICE_DATE_SKEW_DAYS) {
    return { date: device, source: "device" };
  }
  return { date: server, source: "server" };
}
