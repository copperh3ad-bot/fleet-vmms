import { body, check, fill, go, has, press, scenario, sql, step, waitText } from "./lib.mjs";

// ADR-079 phase C: a cargo pick-up and delivery request from the web form, accepted by the fleet manager, turned into a trip, and followed to delivery.
// Needs scenarios 2 to 4 (the company, its administrator and its manager).
export async function cargo(S) {
  scenario("13. A cargo pick-up and delivery request is made, accepted and turned into a trip");
  const o = S.pk, mgr = S.mgr, slug = S.pkSlug, base = `/w/${slug}`;
  check(o && mgr && slug, "scenarios 2 to 4 did not run");
  const sch = `"${sql(`select schema_name from public.tenants where slug = '${slug}'`)}"`;
  const run = (q) => sql(`set search_path = ${sch}, public; ${q}`);
  const last = (q) => run(q).split("\n").pop();
  run(`insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'`);
  let id;
  const local = (days, hour) => { const d = new Date(Date.now() + days * 86400_000); d.setHours(hour, 0, 0, 0); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:00`; };

  await step("the administrator asks for a pick-up and delivery with the web form", async () => {
    await go(o, `${base}/cargo/new`);
    await waitText(o, "Ask for a cargo pick-up and delivery", 8000);
    await fill(o, "#department", "Sales");
    await fill(o, "#pickup_at", local(2, 9));
    await fill(o, "#pickup_place", "Gulberg warehouse, Lahore");
    await fill(o, "#drop_place", "Karachi head office");
    await fill(o, "#vehicle_type", "10-tonne truck");
    await fill(o, "#description", "Boxes of sample fabric");
    await fill(o, "#quantity_text", "12 cartons, about 300 kg");
    await fill(o, "#poc_details", "Imran 0300 1234567 / Saima 0321 7654321");
    await fill(o, "#instructions", "Unload at gate 2");
    await press(o, "Send the request", { wait: 2000 });
    await waitText(o, "Boxes of sample fabric", 8000);
    id = last(`select id from cargo_requests order by created_at desc limit 1`);
    check(last(`select status || '/' || source || '/' || vehicle_type from cargo_requests where id = '${id}'`) === "requested/app/10-tonne truck", "the request was not saved as expected");
    check(has(await body(o), "Waiting for a decision"), "the page does not say it is waiting");
  });

  await step("a handler cannot decide their own request", async () => {
    await go(o, `${base}/cargo/${id}`);
    await press(o, "Accept the request", { wait: 1500 });
    await waitText(o, "cannot decide your own", 8000);
    check(last(`select status from cargo_requests where id = '${id}'`) === "requested", "the request changed state");
  });

  await step("the manager sees it in the Cargo list, accepts it, and makes a trip from it", async () => {
    await go(mgr, `${base}/cargo`);
    const t = await body(mgr);
    check(has(t, "Boxes of sample fabric") && has(t, "Waiting for a decision"), `the manager's list does not show the request: ${t.slice(0, 200)}`);
    await go(mgr, `${base}/cargo/${id}`);
    await press(mgr, "Accept the request", { wait: 1500 });
    await waitText(mgr, "Accepted", 8000);
    await press(mgr, "Make a trip from this", { wait: 2500 });
    await waitText(mgr, "Cargo CR-", 8000);
    check(/^TR-/.test(last(`select t.trip_no from cargo_requests c join trips t on t.id = c.trip_id where c.id = '${id}'`)), "the cargo request is not linked to a trip");
  });

  await step("it is marked on the way and delivered, and the history says so", async () => {
    await go(mgr, `${base}/cargo/${id}`);
    await press(mgr, "Mark as on the way", { wait: 1500 });
    await waitText(mgr, "On the way", 8000);
    await press(mgr, "Mark as delivered", { wait: 1500 });
    await waitText(mgr, "Delivered", 8000);
    const t = await body(mgr);
    check(has(t, "Trip TR-") && has(t, "made from this request"), "the history does not mention the trip");
  });

  await step("the Cargo menu entry is there for people who may ask or handle", async () => {
    await go(o, base);
    check(has(await body(o), "Cargo"), "the Cargo menu entry is missing");
  });
}
