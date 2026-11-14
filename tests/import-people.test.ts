// The vehicle sheet can name the person who holds each vehicle: new people are made as employees, optionally invited as Requesters limited to their own vehicle, all in the
// same all-or-nothing step as the vehicles (ADR-096). And a person with no valid driving licence on file cannot join until they give one.
import { beforeAll, describe, expect, it } from "vitest";
import type { Membership } from "@/lib/auth/can";
import { ForbiddenError } from "@/lib/auth/can";
import { acceptInvitation, importInviter, listInvitations, previewInvitation, LICENCE_NEEDED, type NewInvite } from "@/lib/admin/service";
import { commitVehicleImport, previewVehicleImport, UserError } from "@/lib/master/service";
import { withTenant } from "@/lib/db/tenant";
import { harness, U, type Org } from "./billing-harness";

let h: Awaited<ReturnType<typeof harness>>;
let org: Org;
let admin: Membership;
let seq = 0;
const plate = () => `PPL-${String(++seq).padStart(3, "0")}`;
const HEAD = "registration_no,employee_no,employee_name,employee_phone,employee_email,licence_no,licence_expires_on";
const sheet = (...rows: string[]) => `${HEAD}\n${rows.join("\n")}\n`;
const read = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(h.router, admin, fn);
let phoneSeq = 0;
const phone = () => `0300 ${String(5550000 + ++phoneSeq)}`;

beforeAll(async () => {
  h = await harness();
  org = await h.org("People Import Co");
  admin = org.admin;
});

/** Commits a sheet the way the vehicle import page does, inviting when asked. Returns what the page would show. */
async function importSheet(text: string, invite: boolean): Promise<{ done: Awaited<ReturnType<typeof commitVehicleImport>>; invites: NewInvite[] }> {
  const inviter = invite ? importInviter(admin) : null;
  const done = await commitVehicleImport(h.router, admin, text, inviter ? { invite: inviter.invite } : {});
  return { done, invites: inviter ? await inviter.finish(h.router) : [] };
}

describe("checking a sheet that names new people", () => {
  it("lists them, says how many can be invited, and says the importer may invite", async () => {
    const p = await previewVehicleImport(h.router, admin, sheet(`${plate()},E-100,Sana Khan,${phone()},sana100@example.com,,`, `${plate()},E-101,Bilal Ahmed,${phone()},,,`));
    expect(p.failed).toBe(0);
    expect(p.people.list.map((x) => x.employee_no)).toEqual(["E-100", "E-101"]);
    expect(p.people.invitable).toBe(1);                       // only the one with an email
    expect(p.canInvite).toBe(true);
  });

  it("names what is wrong: a code nobody has and no name, a bad phone, an expired licence, two different people on one code", async () => {
    const p = await previewVehicleImport(h.router, admin, sheet(
      `${plate()},E-200,,,,,`,
      `${plate()},E-201,Omar Ali,not-a-number,,,`,
      `${plate()},E-202,Zara Noor,${phone()},,LIC-9,2001-01-01`,
      `${plate()},E-203,Same Code,${phone()},,,`,
      `${plate()},E-203,Another Person,${phone()},,,`));
    const errs = p.rows.map((r) => r.errors.join(" | "));
    expect(errs[0]).toMatch(/fill employee_name and employee_phone/);
    expect(errs[1]).toMatch(/employee_phone/);
    expect(errs[2]).toMatch(/licence has expired/);
    expect(errs[4]).toMatch(/has other details for this number/);
    expect(p.failed).toBe(4);
  });

  it("refuses an email or a phone that another employee already has, or that two rows share", async () => {
    await importSheet(sheet(`${plate()},E-300,First Person,${phone()},first300@example.com,,`), false);
    const dupPhone = phone();
    const p = await previewVehicleImport(h.router, admin, sheet(
      `${plate()},E-301,Second,${phone()},first300@example.com,,`,
      `${plate()},E-302,Third,${dupPhone},,,`,
      `${plate()},E-303,Fourth,${dupPhone},,,`));
    expect(p.rows[0].errors.join()).toMatch(/another employee already has first300@example.com/);
    expect(p.rows[2].errors.join()).toMatch(/also on the person at row/);
  });
});

describe("importing a sheet that names new people", () => {
  it("makes the employees and the vehicles together, one person holding two vehicles once, with no invitation when none is asked for", async () => {
    const a = plate(), b = plate();
    const ph = phone();
    const { done, invites } = await importSheet(sheet(`${a},E-400,Hina Malik,${ph},hina400@example.com,,`, `${b},E-400,Hina Malik,${ph},hina400@example.com,,`), false);
    expect(done).toEqual({ imported: 2, people: 1 });
    expect(invites).toEqual([]);
    const held = await read(async (q) => (await q.query<{ n: string }>(
      "select count(*)::text n from vehicles v join vehicle_custody c on c.vehicle_id = v.id and c.to_date is null join employees e on e.id = c.employee_id where e.employee_no = 'E-400' and v.registration_no in ($1, $2)", [a, b])).rows[0].n);
    expect(held).toBe("2");
    expect((await listInvitations(h.router, admin)).some((i) => i.email === "hina400@example.com")).toBe(false);
  });

  it("invites them as Requesters limited to their own vehicle when the importer chooses; a person with no email is added but not invited", async () => {
    const { done, invites } = await importSheet(sheet(`${plate()},E-410,Ayesha Rana,${phone()},ayesha410@example.com,,`, `${plate()},E-411,No Mail,${phone()},,,`), true);
    expect(done.people).toBe(2);
    expect(invites.map((i) => i.email)).toEqual(["ayesha410@example.com"]);
    const open = (await listInvitations(h.router, admin)).find((i) => i.email === "ayesha410@example.com")!;
    expect(open).toMatchObject({ role_key: "requester", vehicle_scope: "own", employee_no: "E-410" });
    const e = await read(async (q) => (await q.query("select 1 from employees where employee_no = 'E-411'")).rows.length);
    expect(e).toBe(1);
  });

  it("is all or nothing: one bad row means no vehicle and no person is saved", async () => {
    const good = plate();
    await expect(commitVehicleImport(h.router, admin, sheet(`${good},E-420,Fine Person,${phone()},,,`, `${plate()},E-421,,,,,`))).rejects.toThrow(UserError);
    const left = await read(async (q) => (await q.query<{ n: string }>("select (select count(*) from vehicles where registration_no = $1) + (select count(*) from employees where employee_no = 'E-420') as n", [good])).rows[0].n);
    expect(Number(left)).toBe(0);
  });

  it("only someone who manages users can invite from the sheet; a fleet manager can still import and add people", async () => {
    const manager: Membership = { ...admin, userId: U(7001), role: "fleet_manager" };
    const p = await previewVehicleImport(h.router, manager, sheet(`${plate()},E-430,Mgr Added,${phone()},mgr430@example.com,,`));
    expect(p.canInvite).toBe(false);
    await expect(commitVehicleImport(h.router, manager, sheet(`${plate()},E-431,Mgr Invited,${phone()},mgr431@example.com,,`), { invite: importInviter(manager).invite })).rejects.toBeInstanceOf(ForbiddenError);
    const left = await read(async (q) => (await q.query("select 1 from employees where employee_no = 'E-431'")).rows.length);
    expect(left).toBe(0);                                      // the refused invitation undid the people and vehicles with it
  });
});

describe("joining needs a valid driving licence", () => {
  const joiner = (n: number, email: string) => ({ id: U(n), email, emailConfirmed: true });

  it("is asked for when the sheet gave none, refused without it, and saved on the employee record when given", async () => {
    const { invites } = await importSheet(sheet(`${plate()},E-500,Imran Sheikh,${phone()},imran500@example.com,,`), true);
    const token = invites[0].token;
    expect((await previewInvitation(h.router, token))?.needsLicence).toBe(true);
    const user = joiner(8001, "imran500@example.com");
    await expect(acceptInvitation(h.router, { token }, user)).rejects.toThrow(LICENCE_NEEDED);
    await expect(acceptInvitation(h.router, { token }, user, { licence_no: "L1", licence_expires_on: "2099-01-01" })).rejects.toThrow(LICENCE_NEEDED);   // too short a number
    await expect(acceptInvitation(h.router, { token }, user, { licence_no: "LHR-5001", licence_expires_on: "2001-01-01" })).rejects.toThrow(/expired/);
    const member = async () => (await read(async (q) => (await q.query("select 1 from public.tenant_memberships where user_id = $1", [U(8001)])).rows.length));
    expect(await member()).toBe(0);                            // every refusal left nothing behind
    await acceptInvitation(h.router, { token }, user, { licence_no: "LHR-5001", licence_class: "LTV", licence_expires_on: "2099-01-01" });
    expect(await member()).toBe(1);
    const lic = await read(async (q) => (await q.query<{ licence_no: string; licence_class: string }>(
      "select l.licence_no, l.licence_class from driver_licences l join employees e on e.id = l.employee_id where e.employee_no = 'E-500'")).rows[0]);
    expect(lic).toEqual({ licence_no: "LHR-5001", licence_class: "LTV" });
  });

  it("is not asked for when the sheet gave a valid licence", async () => {
    const { invites } = await importSheet(sheet(`${plate()},E-510,Nadia Qureshi,${phone()},nadia510@example.com,KHI-9001,2099-06-30`), true);
    expect((await previewInvitation(h.router, invites[0].token))?.needsLicence).toBe(false);
    await acceptInvitation(h.router, { token: invites[0].token }, joiner(8002, "nadia510@example.com"));
    expect(await read(async (q) => (await q.query("select 1 from public.tenant_memberships where user_id = $1", [U(8002)])).rows.length)).toBe(1);
  });

  it("an expired licence on file counts as none: the person is asked again", async () => {
    const { invites } = await importSheet(sheet(`${plate()},E-520,Old Licence,${phone()},old520@example.com,,`), true);
    await read(async (q) => { await q.query("insert into driver_licences(employee_id, licence_no, expires_on, licence_type) select id, 'OLD-1', current_date - 5, 'full' from employees where employee_no = 'E-520'"); });
    expect((await previewInvitation(h.router, invites[0].token))?.needsLicence).toBe(true);
  });
});
