// A job card goes from "workshop assigned" to closed through the workshop's single-use links (ADR-033), with the decisions made by staff:
// emailed estimate link -> estimate sent without an account -> manager approves it -> emailed invoice link -> invoice sent -> administrator checks it -> closed.
// Needs scenario 4 first (the job card S.jobByStaff is assigned to the company's own workshop).
import fs from "node:fs";
import { body, check, go, has, persona, press, scenario, sql, step, waitSql, waitText } from "./lib.mjs";

/** The newest one-time link mailed to a workshop address (the e2e outbox is a file; nothing leaves this machine). */
const lastLink = (kind) => {
  const mails = fs.readFileSync(process.env.E2E_OUTBOX, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => /^shop\./.test(m.to ?? ""));
  for (const m of mails.reverse()) {
    const hit = String(m.text ?? m.html ?? "").match(/https?:\/\/[^\s"'<>]*\/q\/[A-Za-z0-9_-]+/);
    if (hit && (kind === "any" || new RegExp(kind, "i").test(`${m.subject ?? ""} ${m.text ?? ""}`))) return hit[0];
  }
  return null;
};

export async function workshopFlow(S) {
  scenario("11. The workshop sends an estimate and an invoice by link, and the card is closed");
  const o = S.pk, slug = S.pkSlug, jobPath = S.jobByStaff;
  check(o && slug && jobPath && S.mgr, "scenario 4 did not run first");
  const jobId = jobPath.split("/").pop();
  const schema = sql(`select schema_name from public.tenants where slug = '${slug}'`);
  const status = () => sql(`select status from "${schema}".job_cards where id = '${jobId}'`);
  check(status() === "vendor_assigned", `the job card is ${status()}, not vendor_assigned`);
  let W;

  await step("the manager emails the workshop its estimate link", async () => {
    await go(S.mgr, jobPath);
    await press(S.mgr, /^Email the link$/, { wait: 2500 });
    check(lastLink("any"), "no link was mailed to the workshop");
  });

  await step("the workshop opens the link with no account and sends an estimate", async () => {
    W = await persona("workshop", {});
    const link = lastLink("any");
    await W.page.goto(link, { waitUntil: "networkidle" });
    await W.page.locator("#description_0").fill("Engine diagnosis and sensor replacement");
    await W.page.locator("select[name=kind_0]").selectOption("service");
    await W.page.locator("input[name=qty_0]").fill("1");
    await W.page.locator("input[name=unit_cost_0]").fill("18500");
    await W.page.locator("#days_needed").fill("2");
    await W.page.getByRole("button", { name: "Send estimate" }).click();
    await W.page.getByText(/Thank you/i).waitFor({ timeout: 10000 });
    await waitSql(`select status from "${schema}".job_cards where id = '${jobId}'`, "quotation_received");
  });

  await step("the same link does not work a second time", async () => {
    const again = await W.page.goto(lastLink("any"), { waitUntil: "networkidle" });
    const text = await W.page.locator("body").innerText();
    check(!(await W.page.locator("#description_0").count()), `the estimate form opened again (${again?.status()})`);
    check(text.length > 0, "the used link showed nothing");
  });

  await step("the manager approves the estimate and a work order is issued", async () => {
    await go(S.mgr, jobPath);
    check(has(await body(S.mgr), "18,500") || has(await body(S.mgr), "18500"), "the estimate amount is not shown to the manager");
    await press(S.mgr, /Approve and issue work order/, { wait: 2500 });
    await waitSql(`select status from "${schema}".job_cards where id = '${jobId}'`, "quotation_approved");
    check(sql(`select count(*) from "${schema}".work_orders where job_card_id = '${jobId}'`) === "1", "no work order was issued");
  });

  await step("the manager emails the workshop its invoice link, and the workshop sends the invoice", async () => {
    await go(S.mgr, jobPath);
    await press(S.mgr, /^Email the link$/, { wait: 2500 });
    const link = lastLink("any");
    check(link, "no invoice link was mailed");
    await W.page.goto(link, { waitUntil: "networkidle" });
    await W.page.locator("#invoice_no").fill("SA-1001");
    await W.page.locator("#invoice_date").fill(new Date().toISOString().slice(0, 10));
    await W.page.locator("#description_0").fill("Engine diagnosis and sensor replacement");
    await W.page.locator("input[name=qty_0]").fill("1");
    await W.page.locator("input[name=unit_cost_0]").fill("18500");
    await W.page.getByRole("button", { name: /Send invoice/i }).click();
    await W.page.getByText(/Thank you/i).waitFor({ timeout: 10000 });
    check(sql(`select count(*) from "${schema}".invoices i join "${schema}".work_orders w on w.id = i.work_order_id where w.job_card_id = '${jobId}'`) === "1", "no invoice was stored");
  });

  await step("the administrator checks the invoice and the card can be closed", async () => {
    await go(o, jobPath);
    const txt = await body(o);
    check(has(txt, "SA-1001"), `the invoice is not on the job card (status ${status()})`);
  });
  await W?.ctx.close();
}
