// The public Contact us page (ADR-021). Anyone can leave a message, so this does as little as possible: check the fields,
// store one row. Nothing is sent by email from here. The operator reads the messages and marks them handled; both of those
// check that the signed-in person is in platform_admins inside the same transaction.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120, "That name is too long"),
  email: z.email("Enter a valid email address").max(200).transform((s) => s.toLowerCase()),
  company: z.preprocess(blank, z.string().trim().max(120, "That name is too long").optional()),
  topic: z.enum(["sales", "support", "billing", "other"], "Choose a topic"),
  message: z.string().trim().min(10, "Write at least a sentence").max(2000, "Keep it under 2000 characters"),
});
export type ContactInput = z.output<typeof contactSchema>;

export function parseContact(raw: Record<string, unknown>): ContactInput {
  const r = contactSchema.safeParse(raw);
  if (!r.success) throw new UserError("Fix the highlighted fields.", fieldErrors(r.error));
  return r.data;
}

export function recordContact(driver: Driver, input: ContactInput): Promise<void> {
  return withPlatform(driver, async (q) => {
    await q.query("insert into public.contact_messages(name, email, company, topic, message) values ($1, $2, $3, $4, $5)", [input.name, input.email, input.company ?? null, input.topic, input.message]);
    // Handled messages older than a year are tidied away now and then.
    if (Math.random() < 0.02) await q.query("delete from public.contact_messages where status = 'handled' and handled_at < now() - interval '365 days'");
  });
}

export type ContactRow = { id: string; name: string; email: string; company: string | null; topic: string; message: string; status: "new" | "handled"; created_at: string };

async function asOperator<T>(driver: Driver, operatorId: string, fn: (q: Parameters<Parameters<typeof withPlatform>[1]>[0]) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
    return fn(q);
  });
}

export function listContactMessages(driver: Driver, operatorId: string, limit = 100): Promise<ContactRow[]> {
  return asOperator(driver, operatorId, async (q) =>
    (await q.query<ContactRow>("select id, name, email, company, topic, message, status, created_at::text from public.contact_messages order by (status = 'new') desc, created_at desc limit $1", [limit])).rows);
}

export function countNewContactMessages(driver: Driver, operatorId: string): Promise<number> {
  return asOperator(driver, operatorId, async (q) => (await q.query<{ c: number }>("select count(*)::int c from public.contact_messages where status = 'new'")).rows[0].c);
}

export function markContactHandled(driver: Driver, operatorId: string, id: string): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    await q.query("update public.contact_messages set status = 'handled', handled_at = now(), handled_by = $2 where id = $1 and status = 'new'", [id, operatorId]);
  });
}
