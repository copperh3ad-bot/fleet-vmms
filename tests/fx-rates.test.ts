// Dollar-to-rupee rates by date (ADR-018): reading the page, picking the rate for the payment day, and the consent gate.
import { beforeAll, describe, expect, it } from "vitest";
import { UserError } from "@/lib/master/service";
import { fetchInterbankRate, listRates, MAX_STALE_DAYS, parseInterbankPage, pickSide, rateFor, saveRate } from "@/lib/billing/fx";
import { quoteTax } from "@/lib/billing/tax-data";
import { confirmClaim } from "@/lib/billing/operator";
import { submitClaim, getInvoice, listInvoices } from "@/lib/billing/payments";
import { claim, daysAgo, harness, noStore, NOT_OP, OP, today } from "./billing-harness";

// The same shape as the interbank page, with made-up numbers: only the structure is relied on.
const page = (asOn = "Thu, Oct 22 2026, 10:36 PST (GMT+5)", usd = ["276.75", "277.25"]) => `
  <p>As on ${asOn}</p><table>
  <tr><td align="left"><img src="flags/GBP.gif"/> UK Pound Sterling</td><td><a href="x">GBP</a></td><td align="center">370.77</td><td align="center">371.44</td><td>chart</td></tr>
  <tr height="25"><td align="left" ><img src="flags/USD.gif" class="box" />&nbsp;&nbsp; US Dollar</td>
      <td align="center" ><a rel="nofollow" href="currency-inter.php?base=PKR&amp;curr=USD">USD</a></td>
      <td align="center" >${usd[0]}</td>
      <td align="center" >${usd[1]}</td><td>chart</td></tr></table>`;

let h: Awaited<ReturnType<typeof harness>>;
beforeAll(async () => { h = await harness(); });

describe("reading the interbank page", () => {
  it("takes the US Dollar row and the date the page says it is as on", () => {
    expect(parseInterbankPage(page())).toEqual({ date: "2026-10-22", buy: 276.75, sell: 277.25 });
    expect(parseInterbankPage(page("Mon, Jan 5 2026, 09:00 PST", ["1,000.50", "1,001.00"]).replace("1,000.50", "280.5").replace("1,001.00", "281"))).toMatchObject({ date: "2026-01-05", buy: 280.5, sell: 281 });
  });

  it("refuses a page that is not what it was, or numbers that cannot be right", () => {
    expect(() => parseInterbankPage("<html>Maintenance</html>")).toThrow(/As on/);
    expect(() => parseInterbankPage(page().replace("US Dollar", "Euro"))).toThrow(/US Dollar row/);
    expect(() => parseInterbankPage(page(undefined, ["2.77", "2.78"]))).toThrow(/out of range/);
    expect(() => parseInterbankPage(page(undefined, ["280", "270"]))).toThrow(/out of range/);
    expect(() => parseInterbankPage(page(undefined, ["280", "320"]))).toThrow(/out of range/);
  });

  it("picks buying, selling or the middle", () => {
    expect([pickSide(276.75, 277.25, "buying"), pickSide(276.75, 277.25, "selling"), pickSide(276.75, 277.25, "average")]).toEqual([276.75, 277.25, 277]);
  });
});

describe("the rate for a day", () => {
  it("is that day's, or the latest earlier one within a week, and nothing beyond", async () => {
    await saveRate(h.control, OP, { date: daysAgo(20), buy: "270", sell: "271" });
    await saveRate(h.control, OP, { date: daysAgo(10), buy: "275", sell: "276" });
    expect(await h.control.transaction((q) => rateFor(q, daysAgo(10)))).toMatchObject({ rate: 275, date: daysAgo(10), source: "manual", side: "buying" });
    expect(await h.control.transaction((q) => rateFor(q, daysAgo(10), "selling"))).toMatchObject({ rate: 276 });
    expect(await h.control.transaction((q) => rateFor(q, daysAgo(10 - MAX_STALE_DAYS)))).toMatchObject({ date: daysAgo(10) });          // a weekend or a holiday
    expect(await h.control.transaction((q) => rateFor(q, daysAgo(10 - MAX_STALE_DAYS - 1)))).toBeNull();                              // too old to trust
    expect(await h.control.transaction((q) => rateFor(q, daysAgo(30)))).toBeNull();                                                  // before any rate
  });

  it("is entered by the operator only, and bad entries say what is wrong", async () => {
    await expect(saveRate(h.control, NOT_OP, { date: daysAgo(1), buy: "280" })).rejects.toThrow("Not allowed.");
    await expect(listRates(h.control, NOT_OP)).rejects.toThrow("Not allowed.");
    await expect(saveRate(h.control, OP, { date: "2999-01-01", buy: "280" })).rejects.toMatchObject({ fields: { date: expect.any(String) } });
    await expect(saveRate(h.control, OP, { date: daysAgo(1), buy: "abc" })).rejects.toMatchObject({ fields: { buy: expect.any(String) } });
    await expect(saveRate(h.control, OP, { date: daysAgo(1), buy: "280", sell: "270" })).rejects.toBeInstanceOf(UserError);
    await expect(saveRate(h.control, OP, { date: daysAgo(1), buy: "280", sell: "300" })).rejects.toBeInstanceOf(UserError);
    await saveRate(h.control, OP, { date: daysAgo(1), buy: "280" });                                                                    // selling defaults to buying
    expect((await listRates(h.control, OP))[0]).toMatchObject({ rate_date: daysAgo(1), buy: "280.0000", sell: "280.0000", source: "manual" });
  });
});

describe("the automatic fetch is off until consent is on record", () => {
  it("does nothing, and says why, without it", async () => {
    let called = 0;
    await expect(fetchInterbankRate(h.control, OP, async () => { called++; return page(); })).rejects.toThrow(/written consent/);
    await expect(fetchInterbankRate(h.control, null, async () => { called++; return page(); })).rejects.toThrow(/written consent/);
    expect(called).toBe(0);                                                                                                           // not even a request
  });

  it("with consent: stores the rate under the page's own date, never over a rate entered by hand, and refuses a jump", async () => {
    await h.set("fx_forexpk_consent", "Email from forex.pk, 12 Nov 2026");
    const date = daysAgo(3);
    const stamp = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(/^(\w+), (\w+) (\d+), (\d+)$/, "$1, $2 $3 $4");
    const r = await fetchInterbankRate(h.control, null, async () => page(`${stamp}, 10:36 PST (GMT+5)`, ["281.10", "281.60"]));
    expect(r).toMatchObject({ date, buy: 281.1, sell: 281.6, stored: true });
    expect((await listRates(h.control, OP)).find((x) => x.rate_date === date)).toMatchObject({ source: "forex.pk", buy: "281.1000" });
    // the operator corrects that day by hand; a later fetch for the same day does not undo it
    await saveRate(h.control, OP, { date, buy: "281.50", sell: "282", note: "Bank advice" });
    expect(await fetchInterbankRate(h.control, null, async () => page(`${stamp}, 18:00 PST (GMT+5)`, ["281.10", "281.60"]))).toMatchObject({ stored: false });
    expect((await listRates(h.control, OP)).find((x) => x.rate_date === date)).toMatchObject({ source: "manual", buy: "281.5000" });
    // a misread: far from the last rate
    const jumpDate = daysAgo(1);   // a recent date, so the test does not age out as the calendar moves on
    const jumpStamp = new Date(`${jumpDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).replace(/^(\w+), (\w+) (\d+), (\d+)$/, "$1, $2 $3 $4");
    await expect(fetchInterbankRate(h.control, null, async () => page(`${jumpStamp}, 10:00 PST (GMT+5)`, ["390.00", "391.00"]))).rejects.toThrow(/more than 10%/);
    // the site is down, or the page changed
    await expect(fetchInterbankRate(h.control, null, async () => { throw new Error("HTTP 503"); })).rejects.toThrow(/could not be read.*HTTP 503/);
    await expect(fetchInterbankRate(h.control, null, async () => "<html>new design</html>")).rejects.toThrow(/could not be read/);
    // a future date on the page is not stored
    await expect(fetchInterbankRate(h.control, null, async () => page("Mon, Jan 4 2100, 10:00 PST (GMT+5)"))).rejects.toThrow(/future/);
  });

  it("consent is just a note: clearing it turns the fetch off again", async () => {
    await h.set("fx_forexpk_consent", "");
    await expect(fetchInterbankRate(h.control, null, async () => page())).rejects.toThrow(/written consent/);
  });
});

describe("a tax invoice uses the rate for the day the customer paid", () => {
  it("picks that day's rate over today's, and falls back to the settings rate only when there is none", async () => {
    await h.sellerReady("300");                                                                                                     // the fallback
    await saveRate(h.control, OP, { date: daysAgo(40), buy: "260", sell: "261" });
    await saveRate(h.control, OP, { date: today(), buy: "285", sell: "286" });
    const c = await h.org("Dated Customer", { country: "PK", profile: h.pk() });

    const q = await quoteTax(h.router, c.admin, 14900, "USD", 1);
    expect(q?.snapshot.fx).toMatchObject({ rate: 285, source: "manual", rate_date: today() });                                      // today's, for the amount to send

    const oldClaim = (await submitClaim(h.router, noStore, c.admin, claim({ paid_on: daysAgo(40), amount: "10000", currency: "PKR" }))).id;
    await confirmClaim(h.control, OP, oldClaim);
    const inv = (await getInvoice(h.router, c.admin, (await listInvoices(h.router, c.admin))[0].id))!;
    expect(inv.tax?.snapshot.fx).toMatchObject({ rate: 260, source: "manual", rate_date: daysAgo(40), payment_date: daysAgo(40) });
    expect(inv.tax?.subtotal_minor).toBe("3874000");                                                                                // 149 x 260

    const noRate = (await submitClaim(h.router, noStore, c.admin, claim({ paid_on: daysAgo(100) }))).id;                            // before any stored rate (and past the 120-day limit it would not file)
    await confirmClaim(h.control, OP, noRate);
    const inv2 = (await getInvoice(h.router, c.admin, (await listInvoices(h.router, c.admin))[0].id))!;
    expect(inv2.tax?.snapshot.fx).toMatchObject({ rate: 300, source: "settings" });
    expect(inv2.tax?.subtotal_minor).toBe("4470000");
  });

  it("the side of the rate follows the setting", async () => {
    const c = await h.org("Side Customer", { country: "PK", profile: h.pk() });
    await h.set("fx_side", "selling");
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.snapshot.fx).toMatchObject({ rate: 286, side: "selling" });
    await h.set("fx_side", "average");
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.snapshot.fx).toMatchObject({ rate: 285.5, side: "average" });
    await h.set("fx_side", "");
    expect((await quoteTax(h.router, c.admin, 14900, "USD", 1))?.snapshot.fx).toMatchObject({ rate: 285, side: "buying" });
  });
});
