// The trial countdown (what the banner shows while a free trial runs). It works from milliseconds left, so a device's wrong clock cannot change it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countdown } from "@/lib/billing/countdown";
import { accessFrom } from "@/lib/billing/state";

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe("the trial countdown", () => {
  it("shows days, hours, minutes and seconds while there are days left", () => {
    const c = countdown(2 * D + 14 * H + 5 * M + 9 * S);
    expect(c).toMatchObject({ done: false, days: 2, hours: 14, minutes: 5, seconds: 9, text: "2 d 14 h 05 m 09 s", tone: "info" });
    expect(countdown(3 * D).text).toBe("3 d 00 h 00 m 00 s");
  });
  it("drops the days, then the hours, as the end gets near", () => {
    expect(countdown(5 * H + 7 * M + 3 * S).text).toBe("5 h 07 m 03 s");
    expect(countdown(42 * M + 5 * S).text).toBe("42 m 05 s");
    expect(countdown(9 * S).text).toBe("0 m 09 s");
  });
  it("is calm with more than a day, a warning in the last day, urgent in the last hour", () => {
    expect(countdown(D + S).tone).toBe("info");
    expect(countdown(D).tone).toBe("warn");
    expect(countdown(2 * H).tone).toBe("warn");
    expect(countdown(H).tone).toBe("bad");
    expect(countdown(10 * S).tone).toBe("bad");
  });
  it("rounds up, so it never says the trial is over while a fraction of a second is left, and is done only at zero", () => {
    expect(countdown(1).seconds).toBe(1);
    expect(countdown(1).done).toBe(false);
    expect(countdown(0)).toMatchObject({ done: true, text: "0 s", spoken: "Your free trial has ended." });
    expect(countdown(-5000).done).toBe(true);                         // a clock that ran past the end
  });
  it("gives a screen reader a sentence that changes once a minute, not every second", () => {
    expect(countdown(2 * D + 14 * H + 5 * M + 9 * S).spoken).toBe("Your free trial ends in 2 days, 14 hours and 5 minutes.");
    expect(countdown(2 * D + 14 * H + 5 * M + 8 * S).spoken).toBe(countdown(2 * D + 14 * H + 5 * M + 9 * S).spoken);
    expect(countdown(1 * D + 1 * H + 1 * M).spoken).toBe("Your free trial ends in 1 day, 1 hour and 1 minute.");
    expect(countdown(3 * H + 30 * M).spoken).toBe("Your free trial ends in 3 hours and 30 minutes.");
    expect(countdown(30 * S).spoken).toBe("Your free trial ends in 1 minute.");
  });
  it("the billing state gives the exact time left in a running trial, and nothing in any other state", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const row = (over: Record<string, unknown>) => ({ status: "trialing" as const, trial_ends_at: "2026-10-31T12:00:00Z", current_period_end: null, grace_days: 5, comped: false, suspended: false, price_cents: 1, currency: "USD", ...over });
    expect(accessFrom(row({}), now)).toMatchObject({ state: "trial", trialMsLeft: 3 * D });
    expect(accessFrom(row({ trial_ends_at: "2026-10-28T12:00:01Z" }), now).trialMsLeft).toBe(1000);
    expect(accessFrom(row({ trial_ends_at: "2026-10-28T12:00:00Z" }), now).trialMsLeft).toBeUndefined();        // over: locked, no countdown
    expect(accessFrom(row({ comped: true }), now).trialMsLeft).toBeUndefined();
    expect(accessFrom(row({ status: "active", current_period_end: "2026-11-30T00:00:00Z" }), now).trialMsLeft).toBeUndefined();
  });
  it("the banner counts down from what the server measured and uses a monotonic clock, never the device's date", () => {
    const comp = readFileSync("src/components/shell/trial-countdown.tsx", "utf8");
    expect(comp).toContain("performance.now()");
    expect(comp).not.toMatch(/Date\.now\(\)|new Date\(/);
    const banner = readFileSync("src/components/shell/access-banner.tsx", "utf8");
    expect(banner).toContain("<TrialCountdown");
    expect(banner).toContain("fallback={msg.text}");                  // the plain sentence shows until the browser starts counting
  });
});
