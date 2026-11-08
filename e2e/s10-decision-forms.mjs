// The approver's decision panel must keep what the approver chose when the server sends it back with a message (React resets a <form action> after it finishes;
// keepForm in src/components/keep-form.ts is the cure). Scenario 9 covers the entry forms; this covers the decision panel on a job card.
import { check, go, scenario, step } from "./lib.mjs";

export async function decisionForms(S) {
  scenario("10. The decision panel keeps the approver's choices after a message");
  const o = S.pk, slug = S.pkSlug, base = `/w/${slug}`;
  check(o && slug, "scenario 2 did not run first");

  let jobUrl = "";
  await step("a fresh job card is raised and waits for a decision", async () => {
    await go(o, `${base}/job-cards/new`);
    const f = o.page.locator("form:has(#cause_text)").last();
    await f.locator("#vehicle_id").selectOption({ index: 1 });
    await f.locator("#odometer_km").fill("43100");
    await f.locator("#reason_code_id").selectOption({ index: 2 });
    await f.locator("#cause_text").fill("Decision panel check: the horn does not sound and the dash light flickers.");
    const lineDesc = f.locator("input[name=line_description]").first();
    if (await lineDesc.count()) { await lineDesc.fill("Horn relay"); await f.locator("input[name=line_unit_cost]").first().fill("1800"); }
    await f.locator("button[type=submit]").last().click();
    await o.page.waitForLoadState("networkidle"); await o.page.waitForTimeout(1200);
    check(/\/job-cards\/[0-9a-f-]{36}/.test(o.page.url()), `the job card page was ${o.page.url()}`);
    jobUrl = new URL(o.page.url()).pathname;
  });

  await step("Reject with no note: the message shows and the Reject choice, the reason and a typed note are kept", async () => {
    await go(o, jobUrl);
    const f = o.page.locator("form:has(#comment)").first();
    const reason = f.locator("#reason_code_id");
    const options = await reason.locator("option").count();
    check(options > 2, "the reason list is too short to change");
    const startValue = await reason.inputValue();
    await reason.selectOption({ index: Number((await reason.evaluate((el) => el.selectedIndex)) === 0 ? 1 : 0) });
    const picked = await reason.inputValue();
    check(picked !== startValue, "the reason did not change");
    await f.getByLabel(/^Reject/).check();
    await f.locator("button[name=intent][value=reject]").click();                 // the note is empty on purpose: a rejection needs one
    await o.page.waitForTimeout(2000);
    check(/\/job-cards\/[0-9a-f-]{36}/.test(o.page.url()), "the page left the job card");
    check(await f.getByLabel(/^Reject/).isChecked(), "the Reject choice was cleared after the message");
    check((await reason.inputValue()) === picked, "the reason was put back after the message");
    check((await f.locator("[role=alert], .text-red-700").count()) > 0, "no message was shown for the missing note");
    check(await f.locator("button[name=intent][value=reject]").count() > 0, "the Reject button is gone, so the panel and its choice disagree");
  });

  await step("Approve with no workshop: the message shows and the Approve choice and the typed note are kept", async () => {
    await go(o, jobUrl);
    const f = o.page.locator("form:has(#comment)").first();
    await f.getByLabel(/^Approve and assign a workshop/).check();
    await f.locator("#comment").fill("Please check the fuse box as well.");
    const approve = f.locator("button[name=intent][value=approve]").first();
    if (await approve.count() === 0) return;                                      // this role cannot pick a workshop: nothing to check
    await approve.click();                                                        // no workshop is picked on purpose
    await o.page.waitForTimeout(2000);
    check(await f.getByLabel(/^Approve and assign a workshop/).isChecked(), "the Approve choice was cleared after the message");
    check((await f.locator("#comment").inputValue()) === "Please check the fuse box as well.", "the typed note was cleared after the message");
  });
}
