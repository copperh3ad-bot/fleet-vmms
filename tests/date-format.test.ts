import { describe, it, expect } from "vitest";
import { dmy, dmyTime, dm } from "@/lib/format/date";

describe("dates are shown as dd/mm/yy (ADR-060)", () => {
  it("formats a date-only value without drifting a day", () => {
    expect(dmy("2026-11-07")).toBe("07/11/26");
    expect(dmy("2031-01-31")).toBe("31/01/31");
  });
  it("formats a timestamp in UTC", () => {
    expect(dmy("2026-11-07T23:30:00Z")).toBe("07/11/26");
    expect(dmy("2026-11-07 19:00:00+00")).toBe("07/11/26");
    expect(dmyTime("2026-11-07T14:05:00Z")).toBe("07/11/26 14:05 UTC");
  });
  it("pads day, month and year, and the old short form shows the year too", () => {
    expect(dmy("2009-03-04")).toBe("04/03/09");
    expect(dm("2026-03-04")).toBe("04/03/26");
  });
  it("shows a dash for nothing and leaves text that is not a date alone", () => {
    expect(dmy(null)).toBe("—");
    expect(dmy(undefined)).toBe("—");
    expect(dmy("")).toBe("—");
    expect(dmy("soon")).toBe("soon");
  });
  it("takes a Date too", () => {
    expect(dmy(new Date(Date.UTC(2026, 10, 7)))).toBe("07/11/26");
  });
});
