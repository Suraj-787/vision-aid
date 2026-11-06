/**
 * Deterministic expiry-date reading and comparison (Milestone 6).
 *
 * The AI only reports the date text it sees and what the label says it is. This
 * module decides what that text means and whether the date has passed, in plain
 * TypeScript, so the answer never depends on a model doing calendar arithmetic.
 *
 * What it cannot do: it cannot know the text was read correctly from the photo,
 * or that the label was identified correctly. It only guards what it can check
 * (formats, calendar validity, label consistency) and says "unclear" otherwise.
 *
 * Rules (also documented in docs/ask-api.md):
 *  - Only EXPIRY, BEST BEFORE and USE BY dates are compared. A manufacturing or
 *    packing date is never treated as an expiry date.
 *  - Day-first (DD/MM/YYYY), month names and ISO (YYYY-MM-DD) are understood. A
 *    numeric date whose day/month order cannot be known is read both ways; if the
 *    readings disagree about "expired", the result is "unclear".
 *  - Month and year only (08/2027, AUG 2027): treated as valid through the LAST
 *    DAY of that month, and the assumption is stated.
 *  - Two-digit years are read as 20YY, and that assumption is stated.
 *  - The date itself counts as still valid ("not_expired" on the day).
 *  - Nothing is ever invented: relative dates ("6 months from manufacture"),
 *    missing years, unknown words and impossible dates give "unclear".
 */
import {
  compareDates,
  formatDate,
  formatIso,
  formatMonthYear,
  isValidDate,
  lastDayOfMonth,
  MAX_PLAUSIBLE_YEAR,
  MIN_PLAUSIBLE_YEAR,
  parseIsoDate,
  type DateOnly,
  type TodaySource,
} from "@/lib/ask/dates";

export const EXPIRY_KINDS = ["expiry", "best_before", "use_by", "unclear"] as const;
export type ExpiryKind = (typeof EXPIRY_KINDS)[number];

export type ExpiryStatus = "expired" | "not_expired" | "unclear";
export const EXPIRY_STATUSES: readonly ExpiryStatus[] = ["expired", "not_expired", "unclear"];

/** What the model reports. All values are printed text, never interpreted dates. */
export interface ExpiryInput {
  /** Date text for an expiry / best-before / use-by label, exactly as printed. */
  expiryText: string | null;
  expiryKind: ExpiryKind | null;
  /** Date text labelled MFG / MFD / packed, exactly as printed. */
  manufacturingText: string | null;
  /** Any other date-related printed text (for example an unlabelled date). */
  dateText: string | null;
}

export interface ExpiryCheck {
  status: ExpiryStatus;
  kind: ExpiryKind | null;
  /** The expiry-type date exactly as the AI read it from the package, or null. */
  printed_text: string | null;
  /** The manufacturing/packing date as printed, shown for context only. */
  manufacturing_text: string | null;
  /** Plain-language reading of the printed date, for example "31 August 2027". */
  interpreted_as: string | null;
  /** The calendar date the comparison used, YYYY-MM-DD. */
  checked_on: string;
  checked_on_source: TodaySource;
  /** User-facing explanation written by this code, not by the AI. */
  explanation: string;
  /** Assumptions that were needed to read the date. Empty when none. */
  assumptions: string[];
}

// ---------------------------------------------------------------- parsing

const MONTHS: Record<string, number> = {
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4,
  MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7, AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
};

/** Words that only label a date and carry no date information. */
const LABEL_WORDS = new Set([
  "EXP", "EXPIRY", "EXPIRES", "EXPIRE", "EXPIRING", "EXPIRATION", "DATE", "DT",
  "BEST", "BEFORE", "USE", "BY", "BB", "BBE", "END", "ON", "OF", "VALID",
  "UNTIL", "TILL", "UPTO", "TO", "IS", "THE", "ST", "ND", "RD", "TH",
]);

/** Words that mark a manufacturing / packing date. */
const MANUFACTURING_WORDS = new Set([
  "MFG", "MFD", "MANUFACTURED", "MANUFACTURING", "MANUFACTURE", "PKD", "PACKED",
  "PKG", "PACKING", "PACK",
]);

function tokenize(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/([A-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Z])/g, "$1 $2")
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** True when the printed text carries a manufacturing / packing label word. */
export function hasManufacturingLabel(text: string): boolean {
  return tokenize(text).some((t) => MANUFACTURING_WORDS.has(t));
}

interface Reading {
  /** First day this reading covers (the 1st for month-only dates). */
  start: DateOnly;
  /** Last day the printed date is valid through (month end for month-only dates). */
  validThrough: DateOnly;
  /** Plain-language form, for example "6 May 2027" or "May 2027". */
  description: string;
}

type ParseResult =
  | { ok: true; precision: "day" | "month"; readings: Reading[]; assumptions: string[] }
  | { ok: false; reason: string };

const fail = (reason: string): ParseResult => ({ ok: false, reason });

function plausible(year: number): boolean {
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}

function dayReading(year: number, month: number, day: number): Reading | null {
  if (!plausible(year) || !isValidDate(year, month, day)) return null;
  const d = { year, month, day };
  return { start: d, validThrough: d, description: formatDate(d) };
}

function monthReading(year: number, month: number): Reading | null {
  if (!plausible(year) || month < 1 || month > 12) return null;
  return {
    start: { year, month, day: 1 },
    validThrough: lastDayOfMonth(year, month),
    description: formatMonthYear(year, month),
  };
}

function dedupe(readings: Array<Reading | null>): Reading[] {
  const seen = new Set<string>();
  const out: Reading[] = [];
  for (const r of readings) {
    if (!r) continue;
    const key = `${formatIso(r.start)}/${formatIso(r.validThrough)}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

type Tok = { kind: "month"; month: number } | { kind: "num"; digits: string };

/** Years may be 2 or 4 digits. Returns the full year and whether it was expanded. */
function fullYear(digits: string): { year: number; expanded: boolean } | null {
  if (digits.length === 4) return { year: Number(digits), expanded: false };
  if (digits.length === 2) return { year: 2000 + Number(digits), expanded: true };
  return null;
}

const isDayOrMonthDigits = (d: string) => d.length >= 1 && d.length <= 2;

/**
 * Reads printed date text into the dates it could mean. Never guesses silently:
 * every assumption is returned, and text that cannot be read safely fails.
 * `allowManufacturingLabel` is for reading a manufacturing date; for an expiry
 * date a manufacturing label word makes the text unusable.
 */
export function parseDateText(
  text: string,
  options: { allowManufacturingLabel?: boolean } = {},
): ParseResult {
  const raw = tokenize(text);
  if (raw.some((t) => MANUFACTURING_WORDS.has(t)) && !options.allowManufacturingLabel) {
    return fail("it is labelled as a manufacturing or packing date, not an expiry date");
  }

  const tokens: Tok[] = [];
  for (const t of raw) {
    if (MANUFACTURING_WORDS.has(t) || LABEL_WORDS.has(t)) continue;
    if (/^\d+$/.test(t)) tokens.push({ kind: "num", digits: t });
    else if (MONTHS[t] !== undefined) tokens.push({ kind: "month", month: MONTHS[t] });
    else return fail("it contains words or symbols that I cannot read as a date");
  }
  if (tokens.length === 0) return fail("there is no readable date in it");
  if (tokens.length > 3) return fail("it contains more than one date or extra numbers");

  for (const t of tokens) {
    if (t.kind === "num" && ![1, 2, 4].includes(t.digits.length)) {
      return fail("the digits are run together or have an unexpected length");
    }
  }

  const assumptions: string[] = [];
  const noteTwoDigitYear = (digits: string) =>
    assumptions.push(`The two-digit year "${digits}" was read as 20${digits}.`);

  const shape = tokens.map((t) => (t.kind === "month" ? "M" : "N")).join("");
  const num = (i: number) => (tokens[i] as { kind: "num"; digits: string }).digits;
  const mon = (i: number) => (tokens[i] as { kind: "month"; month: number }).month;

  // --- one token
  if (shape === "M") return fail("only a month is printed, with no year");
  if (shape === "N") {
    return fail(num(0).length === 4 ? "only a year is printed, with no month" : "only a number is printed, not a full date");
  }

  // --- month name + year ("AUG 2027", "2027 AUG")
  if (shape === "MN" || shape === "NM") {
    const digits = shape === "MN" ? num(1) : num(0);
    const month = shape === "MN" ? mon(0) : mon(1);
    // "AUG 15" / "15 AUG": a short number next to a month name could be a day or a
    // two-digit year. Only a number that cannot be a day (32-99) is read as a year.
    if (digits.length <= 2 && Number(digits) <= 31) {
      return fail("a month name next to a short number could be a day or a two-digit year, and there is no way to tell which");
    }
    const y = fullYear(digits);
    if (!y) return fail("the year is not 2 or 4 digits");
    if (y.expanded) noteTwoDigitYear(digits);
    const r = monthReading(y.year, month);
    if (!r) return fail("the year is outside the range I accept (2000-2099)");
    assumptions.push(monthEndAssumption(r));
    return { ok: true, precision: "month", readings: [r], assumptions };
  }

  // --- full date with a month name: "15 MAR 2027", "2027 MAR 15", "MAR 15 2027"
  if (shape === "NMN" || shape === "MNN") {
    let dayDigits: string;
    let yearDigits: string;
    let month: number;
    if (shape === "MNN") {
      month = mon(0); dayDigits = num(1); yearDigits = num(2);
    } else if (num(0).length === 4) {
      yearDigits = num(0); month = mon(1); dayDigits = num(2); // 2027 MAR 15
    } else {
      dayDigits = num(0); month = mon(1); yearDigits = num(2); // 15 MAR 2027
    }
    if (!isDayOrMonthDigits(dayDigits)) return fail("the day is not a 1 or 2 digit number");
    const y = fullYear(yearDigits);
    if (!y) return fail("the year is not 2 or 4 digits");
    if (y.expanded) noteTwoDigitYear(yearDigits);
    const r = dayReading(y.year, month, Number(dayDigits));
    if (!r) return fail("it is not a real calendar date");
    return { ok: true, precision: "day", readings: [r], assumptions };
  }

  if (tokens.some((t) => t.kind === "month")) return fail("the arrangement of day, month and year is not one I can read");

  // --- numeric only
  if (tokens.length === 2) {
    const [a, b] = [num(0), num(1)];
    // YYYY/MM
    if (a.length === 4 && isDayOrMonthDigits(b)) {
      const r = monthReading(Number(a), Number(b));
      if (!r) return fail("it is not a valid year and month");
      assumptions.push(monthEndAssumption(r));
      return { ok: true, precision: "month", readings: [r], assumptions };
    }
    // MM/YYYY
    if (isDayOrMonthDigits(a) && b.length === 4) {
      const r = monthReading(Number(b), Number(a));
      if (!r) return fail("it is not a valid month and year");
      assumptions.push(monthEndAssumption(r));
      return { ok: true, precision: "month", readings: [r], assumptions };
    }
    // MM/YY: only when the second number cannot be a month, so day/month vs month/year is not in doubt
    if (isDayOrMonthDigits(a) && b.length === 2) {
      const first = Number(a);
      const second = Number(b);
      if (first >= 1 && first <= 12 && second > 12) {
        noteTwoDigitYear(b);
        const r = monthReading(2000 + second, first);
        if (!r) return fail("the year is outside the range I accept (2000-2099)");
        assumptions.push(monthEndAssumption(r));
        return { ok: true, precision: "month", readings: [r], assumptions };
      }
      return fail("two short numbers could be month/year, year/month or day/month, and I cannot tell which");
    }
    return fail("it is not a date format I can read safely");
  }

  // three numbers
  const [a, b, c] = [num(0), num(1), num(2)];
  if (a.length === 4) {
    // YYYY-MM-DD
    if (!isDayOrMonthDigits(b) || !isDayOrMonthDigits(c)) return fail("it is not a date format I can read safely");
    const r = dayReading(Number(a), Number(b), Number(c));
    if (!r) return fail("it is not a real calendar date");
    return { ok: true, precision: "day", readings: [r], assumptions };
  }
  if (b.length === 4 || !isDayOrMonthDigits(a) || !isDayOrMonthDigits(b)) {
    return fail("it is not a date format I can read safely");
  }
  const y = fullYear(c);
  if (!y) return fail("the year is not 2 or 4 digits");
  const first = Number(a);
  const second = Number(b);
  if (c.length === 2 && first > 31) return fail("the order of year, month and day is unclear");
  // Day-first (DD/MM/YYYY, the usual Indian printing) and month-first (MM/DD/YYYY).
  const readings = dedupe([
    dayReading(y.year, second, first), // day first
    dayReading(y.year, first, second), // month first
  ]);
  if (readings.length === 0) return fail("it is not a real calendar date");
  if (y.expanded) noteTwoDigitYear(c);
  if (readings.length > 1) {
    assumptions.push(
      `The day and month order is ambiguous: it could be ${readings.map((r) => r.description).join(" or ")}.`,
    );
  }
  return { ok: true, precision: "day", readings, assumptions };
}

function monthEndAssumption(r: Reading): string {
  return `Only a month and year are printed, so I treated it as valid through the end of the month (${formatDate(r.validThrough)}).`;
}

// ------------------------------------------------------------- the check

const KIND_LABEL: Record<ExpiryKind, string> = {
  expiry: "expiry date",
  best_before: "best-before date",
  use_by: "use-by date",
  unclear: "date",
};

function blank(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t === "" ? null : t;
}

function normaliseForCompare(text: string): string {
  return tokenize(text).join(" ");
}

/**
 * Compares the printed expiry-type date with `today` (a date-only value). The
 * result is always one of expired / not_expired / unclear, with a plain
 * explanation and the original printed text.
 */
export function checkExpiry(
  input: ExpiryInput,
  today: DateOnly,
  todaySource: TodaySource,
): ExpiryCheck {
  const expiryText = blank(input.expiryText);
  const manufacturingText = blank(input.manufacturingText);
  const dateText = blank(input.dateText);
  const base = {
    kind: input.expiryKind,
    printed_text: expiryText,
    manufacturing_text: manufacturingText,
    checked_on: formatIso(today),
    checked_on_source: todaySource,
  };
  const unclear = (explanation: string, assumptions: string[] = [], interpreted: string | null = null): ExpiryCheck => ({
    ...base,
    status: "unclear",
    interpreted_as: interpreted,
    explanation,
    assumptions,
  });

  // ---- no expiry-type date reported
  if (expiryText === null) {
    if (manufacturingText !== null) {
      return unclear(
        `Only a manufacturing or packing date was found ("${manufacturingText}"). That is not an expiry date, so I cannot tell whether the product has expired.`,
      );
    }
    if (dateText !== null) {
      return unclear(
        `A date was found ("${dateText}") but it is not labelled as an expiry, best-before or use-by date, so I did not treat it as one.`,
      );
    }
    return unclear("I could not find a printed expiry date in this photo.");
  }

  // ---- label checks
  if (input.expiryKind === null || input.expiryKind === "unclear") {
    return unclear(
      `I found the date "${expiryText}" but could not tell whether it is an expiry date, so I did not compare it with today.`,
    );
  }
  if (hasManufacturingLabel(expiryText)) {
    return unclear(
      `The date "${expiryText}" is labelled as a manufacturing or packing date, which is not an expiry date, so I did not compare it with today.`,
    );
  }
  if (manufacturingText !== null && normaliseForCompare(manufacturingText) === normaliseForCompare(expiryText)) {
    return unclear(
      `The same date text ("${expiryText}") was reported as both a manufacturing date and an expiry date, so I cannot tell which it is.`,
    );
  }

  const label = KIND_LABEL[input.expiryKind];

  // ---- reading the date
  const parsed = parseDateText(expiryText);
  if (!parsed.ok) {
    return unclear(`I could not read the ${label} "${expiryText}" reliably: ${parsed.reason}. I did not guess.`);
  }

  // ---- consistency with the manufacturing date (only when it is clearly readable)
  if (manufacturingText !== null) {
    const mfg = parseDateText(manufacturingText, { allowManufacturingLabel: true });
    if (mfg.ok) {
      const earliestMfg = mfg.readings.map((r) => r.start).reduce((x, y) => (compareDates(x, y) <= 0 ? x : y));
      const latestExp = parsed.readings.map((r) => r.validThrough).reduce((x, y) => (compareDates(x, y) >= 0 ? x : y));
      if (compareDates(earliestMfg, latestExp) > 0) {
        return unclear(
          `The printed ${label} ("${expiryText}") comes before the manufacturing date ("${manufacturingText}"), so one of them was probably misread. I did not compare it with today.`,
          parsed.assumptions,
        );
      }
    }
  }

  // ---- compare (date-only)
  const statuses = new Set(
    parsed.readings.map((r) => (compareDates(r.validThrough, today) < 0 ? "expired" : "not_expired")),
  );
  const interpreted = parsed.readings.map((r) => r.description).join(" or ");
  const todayText = formatDate(today);

  if (statuses.size > 1) {
    return unclear(
      `The printed ${label} "${expiryText}" could mean ${interpreted}, and those readings give different answers for today (${todayText}), so I cannot say whether it has expired.`,
      parsed.assumptions,
      interpreted,
    );
  }

  const status = [...statuses][0] as "expired" | "not_expired";
  let explanation: string;
  if (status === "expired") {
    explanation = `The printed ${label} "${expiryText}" is read as ${interpreted}. Compared with today's date (${todayText}), that date has passed.`;
  } else if (parsed.readings.some((r) => compareDates(r.validThrough, today) === 0)) {
    explanation = `The printed ${label} "${expiryText}" is read as ${interpreted}. That is today (${todayText}), so it has not passed yet.`;
  } else {
    explanation = `The printed ${label} "${expiryText}" is read as ${interpreted}. Compared with today's date (${todayText}), that date has not passed yet.`;
  }
  return { ...base, status, interpreted_as: interpreted, explanation, assumptions: parsed.assumptions };
}

/** One short sentence for the answer text, derived only from the check. */
export function expiryHeadline(check: ExpiryCheck): string {
  const what = check.kind && check.kind !== "unclear" ? KIND_LABEL[check.kind] : "date";
  if (check.status === "unclear") return "I cannot tell whether it has expired.";
  const shown = check.printed_text ? ` "${check.printed_text}"` : "";
  return check.status === "expired"
    ? `The printed ${what}${shown} has passed.`
    : `The printed ${what}${shown} has not passed yet.`;
}

// ---------------------------------------------------- validation (browser)

const ISO = (v: unknown) => parseIsoDate(v) !== null;

function optString(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" && v.length <= max ? v : undefined;
}

/** Strict validation of an ExpiryCheck received from the server. */
export function parseExpiryCheck(value: unknown): ExpiryCheck | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const status = v.status;
  if (typeof status !== "string" || !EXPIRY_STATUSES.includes(status as ExpiryStatus)) return null;
  const kind = v.kind;
  if (kind !== null && (typeof kind !== "string" || !EXPIRY_KINDS.includes(kind as ExpiryKind))) return null;
  const printed = optString(v.printed_text, 200);
  const mfg = optString(v.manufacturing_text, 200);
  const interpreted = optString(v.interpreted_as, 300);
  if (printed === undefined || mfg === undefined || interpreted === undefined) return null;
  if (!ISO(v.checked_on)) return null;
  if (v.checked_on_source !== "device" && v.checked_on_source !== "server") return null;
  if (typeof v.explanation !== "string" || v.explanation === "" || v.explanation.length > 1200) return null;
  if (!Array.isArray(v.assumptions) || v.assumptions.length > 6) return null;
  if (!v.assumptions.every((a) => typeof a === "string" && a.length <= 400)) return null;
  return {
    status: status as ExpiryStatus,
    kind: kind as ExpiryKind | null,
    printed_text: printed,
    manufacturing_text: mfg,
    interpreted_as: interpreted,
    checked_on: v.checked_on as string,
    checked_on_source: v.checked_on_source,
    explanation: v.explanation,
    assumptions: v.assumptions as string[],
  };
}

