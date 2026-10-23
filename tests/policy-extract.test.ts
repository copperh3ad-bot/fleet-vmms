import { describe, expect, it } from "vitest";
import { extractPolicy, normalize } from "@/lib/docs/policy-extract";

const byId = (text: string) => Object.fromEntries(extractPolicy(text).map((f) => [f.id, f]));

describe("reading numbers out of policy wording", () => {
  it("finds each rule the system can apply, in words or digits", () => {
    const f = byId(`The car may be replaced on completion of six years of life.
      The company will waive off or will not penalize the employee for the first two accidents during employment.
      Minimum one year's time must lapse between the accidents, or more is acceptable for waiver.
      Any other repairs or maintenance costs (excluding consumables) would be shared as 60% by the employer & 40% by the employee.`);
    expect(f.policy_replace_years).toMatchObject({ value: "6", target: { kind: "setting", key: "policy_replace_years" } });
    expect(f.policy_free_accidents.value).toBe("2");
    expect(f.policy_accident_gap_months.value).toBe("12");
    expect(f.policy_driver_share_pct.value).toBe("40");
    expect(f.policy_driver_share_pct.quote).toMatch(/60% by the employer/);
  });

  it("copes with the line breaks, table bars and curly quotes a scan leaves behind", () => {
    const f = byId("Minimum\n eighteen months’ time must  lapse between the accidents.\nRoutine | Oil, Oil/ Air Filter | After every 3 months or\n5,000km, whichever is earlier");
    expect(f.policy_accident_gap_months.value).toBe("18");
    expect(f.service_oil_change).toMatchObject({ target: { kind: "service", name: "Oil change", months: 3, km: 5000 } });
    expect(normalize("a\n b |  c")).toBe("a b c");
  });

  it("reads the share when the employee's part comes first, and refuses numbers that do not add up", () => {
    expect(byId("repairs would be shared as 30% by the employee and 70% by the employer").policy_driver_share_pct.value).toBe("30");
    expect(byId("repairs would be shared as 60% by the employer & 60% by the employee").policy_driver_share_pct).toBeUndefined();
  });

  it("converts years to months and reads tyres and the notes it cannot apply", () => {
    const f = byId(`Minimum two years time must lapse between the accidents. Tires Due after 40,000km of operations.
      The one-time seat covers are subject to a maximum budget of PKR 20,000 per vehicle.
      The Admin department will inspect on Six monthly basis in June and December.
      The existing car will be changed if the individual has run the car for at least three years.`);
    expect(f.policy_accident_gap_months.value).toBe("24");
    expect(f.service_tyres).toMatchObject({ target: { kind: "service", name: "Tyre replacement", km: 40000 } });
    expect(f.info_fitout_cap).toMatchObject({ value: "20,000 per vehicle", target: { kind: "info" } });
    expect(f.info_inspection.value).toBe("six monthly, in June and December");
    expect(f.info_promotion_wait.value).toBe("3 years");
  });

  it("offers nothing the settings would refuse, and nothing when the words are not there", () => {
    expect(byId("The vehicle may be replaced after 99 years.").policy_replace_years).toBeUndefined();
    expect(byId("The vehicle may be replaced after many years.").policy_replace_years).toBeUndefined();
    expect(extractPolicy("")).toEqual([]);
    expect(extractPolicy("Employees must drive carefully and keep the car clean.")).toEqual([]);
  });

  it("gives the same answer every time and never invents a rule from a similar word", () => {
    const text = "Replacement of the battery after 3 years is the dealer's advice.";
    expect(extractPolicy(text)).toEqual(extractPolicy(text));
    expect(byId(text).policy_replace_years).toBeUndefined();                                       // a battery is not the vehicle
    expect(byId("Replacement of the vehicle after 5 years of use.").policy_replace_years.value).toBe("5");
    expect(byId("The oil seal wore out. Service every 3 months or 5000km.").service_oil_change).toBeUndefined();   // another sentence: not read as the oil interval
  });
});
