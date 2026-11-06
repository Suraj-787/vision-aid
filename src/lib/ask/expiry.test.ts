import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareDates,
  daysInMonth,
  formatDate,
  isLeapYear,
  isValidDate,
  parseIsoDate,
  resolveToday,
  type DateOnly,
} from "./dates.ts";
import {
  checkExpiry,
  expiryHeadline,
  parseDateText,
  parseExpiryCheck,
  type ExpiryInput,
  type ExpiryKind,
} from "./expiry.ts";

const D = (year: number, month: number, day: number): DateOnly => ({ year, month, day });
const TODAY = D(2026, 11, 6);

const check = (
  expiryText: string | null,
  options: {
    today?: DateOnly;
    kind?: ExpiryKind | null;
    mfg?: string | null;
    dateText?: string | null;
  } = {},
) => {
  const input: ExpiryInput = {
    expiryText,
    expiryKind: options.kind === undefined ? "expiry" : options.kind,
    manufacturingText: options.mfg ?? null,
    dateText: options.dateText ?? null,
  };
  return checkExpiry(input, options.today ?? TODAY, "device");
};
const status = (text: string | null, today?: DateOnly) => check(text, { today }).status;

describe("date helpers", () => {
  it("leap years and month lengths", () => {
    assert.equal(isLeapYear(2028), true);
    assert.equal(isLeapYear(2027), false);
    assert.equal(isLeapYear(2100), false);
    assert.equal(isLeapYear(2000), true);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2027, 2), 28);
    assert.equal(daysInMonth(2027, 4), 30);
    assert.equal(daysInMonth(2027, 12), 31);
  });

  it("validates calendar dates", () => {
    assert.equal(isValidDate(2028, 2, 29), true);
    assert.equal(isValidDate(2027, 2, 29), false);
    assert.equal(isValidDate(2027, 4, 31), false);
    assert.equal(isValidDate(2027, 13, 1), false);
    assert.equal(isValidDate(2027, 0, 1), false);
    assert.equal(isValidDate(2027, 1, 0), false);
    assert.equal(isValidDate(2027, 1.5, 1), false);
  });

  it("compares date-only values and parses strict ISO", () => {
    assert.equal(compareDates(D(2026, 12, 31), D(2027, 1, 1)), -1);
    assert.equal(compareDates(D(2027, 1, 1), D(2027, 1, 1)), 0);
    assert.equal(compareDates(D(2027, 2, 1), D(2027, 1, 31)), 1);
    assert.deepEqual(parseIsoDate("2026-11-06"), D(2026, 11, 6));
    for (const bad of ["2026-13-01", "2026-02-30", "26-11-06", "2026-1-6", "", null, undefined, 5, "2026-11-06T00:00:00Z"]) {
      assert.equal(parseIsoDate(bad), null, String(bad));
    }
    assert.equal(formatDate(D(2026, 11, 6)), "6 November 2026");
  });
});

describe("resolveToday", () => {
  const nowMs = Date.UTC(2026, 10, 6, 23, 30); // 6 Nov 23:30 UTC = 7 Nov 05:00 in India

  it("prefers the device's local date when it is plausible", () => {
    assert.deepEqual(resolveToday("2026-11-07", nowMs), { date: D(2026, 11, 7), source: "device" });
    assert.deepEqual(resolveToday("2026-11-06", nowMs), { date: D(2026, 11, 6), source: "device" });
    assert.deepEqual(resolveToday("2026-11-04", nowMs), { date: D(2026, 11, 4), source: "device" });
  });

  it("falls back to the server's UTC date for missing, malformed or implausible values", () => {
    for (const v of [undefined, null, "", "garbage", "2026-02-30", "2026-11-10", "2026-11-03", "1999-01-01", "2030-01-01"]) {
      assert.deepEqual(resolveToday(v, nowMs), { date: D(2026, 11, 6), source: "server" }, String(v));
    }
  });

  it("uses UTC fields, so month and year boundaries are exact", () => {
    assert.deepEqual(resolveToday(null, Date.UTC(2026, 11, 31, 23, 59, 59)).date, D(2026, 12, 31));
    assert.deepEqual(resolveToday(null, Date.UTC(2027, 0, 1, 0, 0, 0)).date, D(2027, 1, 1));
    assert.deepEqual(resolveToday(null, Date.UTC(2028, 1, 29, 12)).date, D(2028, 2, 29));
  });
});

describe("expiry: expired and not expired", () => {
  it("a full past date is expired", () => {
    const c = check("EXP 15/03/2026");
    assert.equal(c.status, "expired");
    assert.equal(c.printed_text, "EXP 15/03/2026");
    assert.equal(c.interpreted_as, "15 March 2026");
    assert.match(c.explanation, /has passed/);
    assert.match(c.explanation, /6 November 2026/);
    assert.deepEqual(c.assumptions, []);
  });

  it("a full future date is not expired", () => {
    const c = check("15/03/2027");
    assert.equal(c.status, "not_expired");
    assert.match(c.explanation, /has not passed yet/);
  });

  it("keeps the printed text exactly as given", () => {
    assert.equal(check("  Best Before: 15 Mar 2027 ").printed_text, "Best Before: 15 Mar 2027");
  });

  it("reports which day it checked against and where that day came from", () => {
    const c = checkExpiry({ expiryText: "01/2030", expiryKind: "expiry", manufacturingText: null, dateText: null }, TODAY, "server");
    assert.equal(c.checked_on, "2026-11-06");
    assert.equal(c.checked_on_source, "server");
  });
});

describe("expiry: boundaries (date-only, inclusive of the printed day)", () => {
  it("the printed day itself is not expired; the next day is", () => {
    assert.equal(status("30/11/2026", D(2026, 11, 30)), "not_expired");
    assert.match(check("30/11/2026", { today: D(2026, 11, 30) }).explanation, /That is today/);
    assert.equal(status("30/11/2026", D(2026, 12, 1)), "expired");
    assert.equal(status("30/11/2026", D(2026, 11, 29)), "not_expired");
  });

  it("month-only dates are valid through the last day of that month", () => {
    assert.equal(status("11/2026", D(2026, 11, 30)), "not_expired");
    assert.equal(status("11/2026", D(2026, 12, 1)), "expired");
    assert.equal(status("02/2028", D(2028, 2, 29)), "not_expired"); // leap-year month end
    assert.equal(status("02/2028", D(2028, 3, 1)), "expired");
    assert.equal(status("02/2027", D(2027, 2, 28)), "not_expired");
    assert.equal(status("02/2027", D(2027, 3, 1)), "expired");
  });

  it("year boundaries", () => {
    assert.equal(status("31/12/2026", D(2026, 12, 31)), "not_expired");
    assert.equal(status("31/12/2026", D(2027, 1, 1)), "expired");
    assert.equal(status("01/01/2027", D(2026, 12, 31)), "not_expired");
    assert.equal(status("01/01/2027", D(2027, 1, 1)), "not_expired");
    assert.equal(status("01/01/2027", D(2027, 1, 2)), "expired");
    assert.equal(status("12/2026", D(2026, 12, 31)), "not_expired");
    assert.equal(status("12/2026", D(2027, 1, 1)), "expired");
  });

  it("leap day", () => {
    assert.equal(status("29/02/2028", D(2028, 2, 29)), "not_expired");
    assert.equal(status("29/02/2028", D(2028, 3, 1)), "expired");
    assert.equal(status("29/02/2027", TODAY), "unclear"); // not a real date
  });

  it("is independent of the machine's time zone", () => {
    const zones = ["UTC", "Asia/Kolkata", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Los_Angeles"];
    const original = process.env.TZ;
    try {
      const results = zones.map((tz) => {
        process.env.TZ = tz;
        return JSON.stringify([
          check("30/11/2026", { today: D(2026, 11, 30) }),
          check("30/11/2026", { today: D(2026, 12, 1) }),
          check("11/2026", { today: D(2026, 11, 30) }),
          resolveToday("2026-11-07", Date.UTC(2026, 10, 6, 23, 30)),
          resolveToday(null, Date.UTC(2026, 11, 31, 23, 59)),
        ]);
      });
      assert.equal(new Set(results).size, 1, "identical result in every time zone");
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

describe("expiry: month/year formats state their assumption", () => {
  it("MM/YYYY", () => {
    const c = check("08/2027");
    assert.equal(c.status, "not_expired");
    assert.equal(c.interpreted_as, "August 2027");
    assert.equal(c.assumptions.length, 1);
    assert.match(c.assumptions[0], /Only a month and year are printed/);
    assert.match(c.assumptions[0], /31 August 2027/);
  });

  it("other month/year spellings", () => {
    for (const text of ["AUG 2027", "Aug-2027", "AUGUST 2027", "2027/08", "2027-08", "8/2027", "EXP 08.2027", "08/27"]) {
      const r = parseDateText(text);
      assert.ok(r.ok, text);
      assert.equal(r.precision, "month", text);
      assert.equal(r.readings.length, 1, text);
      assert.equal(r.readings[0].description, "August 2027", text);
      assert.ok(r.assumptions.some((a) => /end of the month/.test(a)), text);
    }
  });

  it("a two-digit year is read as 20YY and says so", () => {
    const r = parseDateText("08/27");
    assert.ok(r.ok);
    assert.ok(r.assumptions.some((a) => /"27" was read as 2027/.test(a)));
    assert.equal(status("12/25", TODAY), "expired"); // Dec 2025
    assert.equal(status("12/27", TODAY), "not_expired");
  });
});

describe("expiry: supported full-date formats", () => {
  const same = (text: string, description: string) => {
    const r = parseDateText(text);
    assert.ok(r.ok, text);
    assert.equal(r.precision, "day", text);
    assert.deepEqual(r.readings.map((x) => x.description), [description], text);
  };

  it("day-first numeric with different separators", () => {
    same("15/03/2027", "15 March 2027");
    same("15-03-2027", "15 March 2027");
    same("15.03.2027", "15 March 2027");
    same("15 03 2027", "15 March 2027");
    same("15/03/27", "15 March 2027");
    same("13/3/2027", "13 March 2027");
  });

  it("a one-digit day and month that could be either way is ambiguous, not guessed", () => {
    const r = parseDateText("1/3/2027");
    assert.ok(r.ok);
    assert.deepEqual(r.readings.map((x) => x.description), ["1 March 2027", "3 January 2027"]);
  });

  it("a month that cannot be a day is read the only possible way", () => {
    same("13/06/2026", "13 June 2026"); // 13 cannot be a month
    same("06/13/2026", "13 June 2026"); // second number cannot be a month
  });

  it("month names", () => {
    same("15 Mar 2027", "15 March 2027");
    same("15-MAR-27", "15 March 2027");
    same("15MAR2027", "15 March 2027");
    same("March 15, 2027", "15 March 2027");
    same("15th March 2027", "15 March 2027");
    same("SEPT 1 2027", "1 September 2027");
  });

  it("year-first", () => {
    same("2027-03-15", "15 March 2027");
    same("2027/3/15", "15 March 2027");
    same("2027 MAR 15", "15 March 2027");
  });

  it("ignores label words around the date", () => {
    for (const text of ["EXP 15/03/2027", "Expiry Date: 15/03/2027", "Best before end 03/2027", "USE BY 15 MAR 2027", "BB 15/03/2027", "EXP. DT. 15.03.2027"]) {
      assert.ok(parseDateText(text).ok, text);
    }
  });
});

describe("expiry: ambiguous formats are never silently interpreted", () => {
  it("day/month order that cannot be told apart is read both ways and stated", () => {
    const r = parseDateText("05/06/2027");
    assert.ok(r.ok);
    assert.deepEqual(r.readings.map((x) => x.description), ["5 June 2027", "6 May 2027"]);
    assert.ok(r.assumptions.some((a) => /ambiguous/.test(a) && /5 June 2027 or 6 May 2027/.test(a)));
  });

  it("when both readings agree on expired/not expired the result stands, with the ambiguity stated", () => {
    const c = check("05/06/2027");
    assert.equal(c.status, "not_expired");
    assert.equal(c.interpreted_as, "5 June 2027 or 6 May 2027");
    assert.ok(c.assumptions.some((a) => /ambiguous/.test(a)));
    assert.equal(check("05/06/2020").status, "expired");
  });

  it("when the readings disagree the result is unclear and explains why", () => {
    const today = D(2026, 5, 20);
    const c = check("05/06/2026", { today }); // 5 June 2026 (not expired) or 6 May 2026 (expired)
    assert.equal(c.status, "unclear");
    assert.match(c.explanation, /could mean/);
    assert.match(c.explanation, /5 June 2026 or 6 May 2026/);
    assert.match(c.explanation, /cannot say whether it has expired/);
  });

  it("identical day and month is not ambiguous", () => {
    const r = parseDateText("05/05/2027");
    assert.ok(r.ok);
    assert.equal(r.readings.length, 1);
    assert.deepEqual(r.assumptions, []);
  });

  it("two short numbers could be month/year, year/month or day/month: unclear", () => {
    for (const text of ["08/09", "12/12", "01/02", "27/08", "13/05", "05/13x"]) {
      assert.equal(status(text), "unclear", text);
    }
    assert.match(check("08/09").explanation, /cannot tell which/);
  });
});

describe("expiry: invalid, incomplete and unreadable dates are unclear", () => {
  const unclear = (text: string) => {
    const c = check(text);
    assert.equal(c.status, "unclear", text);
    assert.match(c.explanation, /I did not guess|did not/, text);
    assert.equal(c.interpreted_as, null, text);
  };

  it("impossible dates", () => {
    for (const text of ["31/04/2027", "32/01/2027", "00/01/2027", "29/02/2027", "30/02/2028", "31/06/2027", "00/2027", "13/2027", "2027-13-01", "2027-02-30"]) {
      unclear(text);
    }
  });

  it("incomplete dates", () => {
    for (const text of ["AUG", "2027", "15", "15 AUG", "AUG 15", "EXP: AUG/27", "15/08", "EXP", "EXP:", "082027", "15082027", "8/2/3/4"]) unclear(text);
  });

  it("a month name with a short number is never read as a year", () => {
    const c = check("AUG 27");
    assert.equal(c.status, "unclear");
    assert.match(c.explanation, /could be a day or a two-digit year/);
    assert.equal(parseDateText("AUG 2027").ok, true); // a four-digit year is fine
    assert.equal(parseDateText("AUG 35").ok, true); // 35 cannot be a day, so it is a year (2035)
  });

  it("words or symbols that are not a date", () => {
    for (const text of ["24 MONTHS", "6 months from manufacture", "see lid", "EXP 08/2027 ABC", "N/A", "----", "⁂", "०८/२०२७"]) unclear(text);
  });

  it("years outside 2000-2099", () => {
    for (const text of ["01/01/1999", "08/2100", "15/03/1850", "01/01/3000"]) unclear(text);
  });

  it("blank text is treated as missing", () => {
    assert.equal(check("").status, "unclear");
    assert.equal(check("   ").printed_text, null);
    assert.match(check(null).explanation, /could not find a printed expiry date/);
  });

  it("never invents a date: relative lifetimes are not computed", () => {
    const c = check("Best before 18 months from manufacture", { mfg: "02/2026" });
    assert.equal(c.status, "unclear");
    assert.equal(c.interpreted_as, null);
  });
});

describe("expiry: manufacturing dates are never expiry dates", () => {
  it("an MFG date with no expiry date is unclear, however old it is", () => {
    const c = check(null, { mfg: "MFG 02/2020" });
    assert.equal(c.status, "unclear");
    assert.equal(c.manufacturing_text, "MFG 02/2020");
    assert.match(c.explanation, /manufacturing or packing date/);
    assert.match(c.explanation, /not an expiry date/);
  });

  it("a date labelled as manufacturing that was filed as the expiry date is not compared", () => {
    for (const text of ["MFG 08/2025", "MFD: 15/03/2020", "Packed on 01/2021", "PKD 05/2026", "Manufactured 2020-01-01"]) {
      const c = check(text);
      assert.equal(c.status, "unclear", text);
      assert.match(c.explanation, /manufacturing or packing date/, text);
      assert.notEqual(c.status, "expired");
      assert.notEqual(c.status, "not_expired");
    }
  });

  it("both dates together: only the expiry date is compared", () => {
    const c = check("08/2027", { mfg: "02/2026" });
    assert.equal(c.status, "not_expired");
    assert.equal(c.manufacturing_text, "02/2026");
    assert.equal(c.printed_text, "08/2027");
    const old = check("08/2025", { mfg: "08/2023" });
    assert.equal(old.status, "expired");
  });

  it("the same text reported as both is unclear", () => {
    const c = check("08/2027", { mfg: "08 / 2027" });
    assert.equal(c.status, "unclear");
    assert.match(c.explanation, /both a manufacturing date and an expiry date/);
  });

  it("an expiry before the manufacturing date means a misread: unclear", () => {
    const c = check("01/2025", { mfg: "06/2026" });
    assert.equal(c.status, "unclear");
    assert.match(c.explanation, /comes before the manufacturing date/);
    assert.equal(check("06/2026", { mfg: "05/2026" }).status, "expired"); // a later month is plausible
  });

  it("an unreadable manufacturing date does not block a readable expiry date", () => {
    assert.equal(check("08/2027", { mfg: "see lid" }).status, "not_expired");
  });

  it("an unlabelled date is not treated as an expiry date", () => {
    const c = check(null, { dateText: "08/2027" });
    assert.equal(c.status, "unclear");
    assert.match(c.explanation, /not labelled as an expiry/);
  });
});

describe("expiry: the label kind", () => {
  it("best-before and use-by are compared and worded as such", () => {
    assert.match(check("08/2025", { kind: "best_before" }).explanation, /best-before date/);
    assert.match(check("08/2025", { kind: "use_by" }).explanation, /use-by date/);
    assert.equal(check("08/2025", { kind: "best_before" }).status, "expired");
    assert.equal(check("08/2025", { kind: "best_before" }).kind, "best_before");
  });

  it("an unknown or missing label means unclear", () => {
    assert.equal(check("08/2027", { kind: null }).status, "unclear");
    assert.equal(check("08/2027", { kind: "unclear" }).status, "unclear");
    assert.match(check("08/2027", { kind: null }).explanation, /could not tell whether it is an expiry date/);
  });
});

describe("expiryHeadline", () => {
  it("is derived only from the deterministic check", () => {
    assert.equal(expiryHeadline(check("08/2025")), 'The printed expiry date "08/2025" has passed.');
    assert.equal(expiryHeadline(check("08/2027", { kind: "best_before" })), 'The printed best-before date "08/2027" has not passed yet.');
    assert.match(expiryHeadline(check(null)), /cannot tell whether it has expired/);
  });

  it("never says anything about safety", () => {
    for (const c of [check("08/2025"), check("08/2027"), check(null)]) {
      assert.doesNotMatch(expiryHeadline(c) + c.explanation, /\bsafe\b|edible|harmless|fine to (eat|use)/i);
    }
  });
});

describe("parseExpiryCheck (validation of a server reply)", () => {
  const good = check("08/2027", { mfg: "02/2026" });

  it("accepts a real check", () => {
    assert.deepEqual(parseExpiryCheck(JSON.parse(JSON.stringify(good))), good);
  });

  it("rejects malformed checks", () => {
    const base = JSON.parse(JSON.stringify(good));
    const bad = (patch: Record<string, unknown>) => parseExpiryCheck({ ...base, ...patch });
    assert.equal(bad({ status: "safe" }), null);
    assert.equal(bad({ status: undefined }), null);
    assert.equal(bad({ kind: "mfg" }), null);
    assert.equal(bad({ checked_on: "06/11/2026" }), null);
    assert.equal(bad({ checked_on_source: "me" }), null);
    assert.equal(bad({ explanation: "" }), null);
    assert.equal(bad({ explanation: "x".repeat(1300) }), null);
    assert.equal(bad({ assumptions: "none" }), null);
    assert.equal(bad({ assumptions: [1] }), null);
    assert.equal(bad({ printed_text: 5 }), null);
    for (const v of [null, undefined, "x", 1, [], true]) assert.equal(parseExpiryCheck(v), null);
  });
});
