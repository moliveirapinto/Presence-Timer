import {
  clampSpan, dayBounds, fmtClock, fmtShort, fmtTimeRange, isToday, toUtcLiteral,
} from "../PresenceTimer/time";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("fmtClock", () => {
  it.each([
    [0, "00:00:00"],
    [9 * SEC, "00:00:09"],
    [90 * SEC, "00:01:30"],
    [2 * HOUR + 3 * MIN + 4 * SEC, "02:03:04"],
    [23 * HOUR + 59 * MIN + 59 * SEC, "23:59:59"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(fmtClock(ms)).toBe(expected);
  });

  // Regression: a weekend offline used to render as "138:22:33".
  it("switches to days past 24h", () => {
    expect(fmtClock(DAY)).toBe("1d 00:00:00");
    expect(fmtClock(5 * DAY + 18 * HOUR + 22 * MIN + 33 * SEC)).toBe("5d 18:22:33");
  });

  it("clamps negatives to zero rather than rendering nonsense", () => {
    expect(fmtClock(-5000)).toBe("00:00:00");
  });
});

describe("fmtShort", () => {
  it.each([
    [42 * SEC, "42s"],
    [3 * MIN + 7 * SEC, "3m 7s"],
    [2 * HOUR + 14 * MIN, "2h 14m"],
    [5 * DAY + 18 * HOUR, "5d 18h"],
    [DAY, "1d 0h"],
    [0, "0s"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(fmtShort(ms)).toBe(expected);
  });
});

describe("dayBounds", () => {
  it("spans local midnight to midnight", () => {
    const b = dayBounds(new Date(2026, 8, 17, 13, 45));
    expect(new Date(b.start).getHours()).toBe(0);
    expect(b.end - b.start).toBe(DAY);
  });
});

describe("clampSpan", () => {
  const day = dayBounds(new Date(2026, 8, 17));
  const noon = day.start + 12 * HOUR;

  it("leaves a segment fully inside the day untouched", () => {
    const { st, en } = clampSpan(noon, noon + HOUR, day, day.end);
    expect(st).toBe(noon);
    expect(en).toBe(noon + HOUR);
  });

  // Regression: a status held since last week made the day render as "No activity".
  it("clamps a segment that started days earlier to the day start", () => {
    const { st, en } = clampSpan(day.start - 5 * DAY, null, day, noon);
    expect(st).toBe(day.start);
    expect(en).toBe(noon);
    expect(en - st).toBe(12 * HOUR);
  });

  it("clamps an open segment on a past day to the day end", () => {
    const { st, en } = clampSpan(noon, null, day, day.end + 3 * DAY);
    expect(st).toBe(noon);
    expect(en).toBe(day.end);
  });

  it("never returns a negative span", () => {
    const { st, en } = clampSpan(day.end + HOUR, null, day, day.end + 2 * HOUR);
    expect(en).toBeGreaterThanOrEqual(st);
  });
});

describe("toUtcLiteral", () => {
  // Regression: a `+02:00` offset is URL-decoded to a space inside an OData $filter.
  it("emits a Z-suffixed literal with no offset sign", () => {
    const s = toUtcLiteral(new Date(Date.UTC(2026, 4, 21, 5, 6, 7)));
    expect(s).toBe("2026-05-21T05:06:07Z");
    expect(s).not.toMatch(/[+]/);
  });

  it("zero-pads every component", () => {
    expect(toUtcLiteral(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("2026-01-02T03:04:05Z");
  });
});

describe("isToday", () => {
  const now = new Date(2026, 8, 17, 12, 0, 0);

  it("is true for the same calendar day at a different time", () => {
    expect(isToday(new Date(2026, 8, 17, 23, 59), now)).toBe(true);
  });

  it("is false either side of midnight", () => {
    expect(isToday(new Date(2026, 8, 16, 23, 59), now)).toBe(false);
    expect(isToday(new Date(2026, 8, 18, 0, 1), now)).toBe(false);
  });
});

describe("fmtTimeRange", () => {
  it("uses 'now' for an open-ended range", () => {
    const s = fmtTimeRange(new Date(2026, 8, 17, 9, 14).toISOString(), null);
    expect(s).toContain("now");
  });
});
