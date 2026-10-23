"use server";
// Building a company's workspace after its owner has confirmed their email (ADR-014). The organization is always the
// one that belongs to the signed-in person's own confirmed address; nothing here takes an organization id from the browser.
import { redirect } from "next/navigation";
import { getDriver } from "@/lib/db";
import { withPlatform } from "@/lib/db/tenant";
import { requireUser } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/auth/can";
import { allowShared } from "@/lib/rate-limit";
import { UserError } from "@/lib/master/service";
import { advanceProvisioning, type ProvisionState } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import { provisionDeps } from "@/lib/orgs/runtime";
import type { FormState } from "@/app/w/[slug]/actions-util";

export type SetupProgress = { state: ProvisionState | "none"; slug?: string; error?: string };

/** One round of work, a few seconds at most. The progress page calls it again until the workspace is ready. */
export async function advanceSetupAction(): Promise<SetupProgress> {
  const user = await requireUser();
  const driver = getDriver();
  if (!user.email || !user.email_confirmed_at) return { state: "none", error: "Confirm your email address first, then come back to this page." };
  if (!(await allowShared(driver, `setup:${user.id}`, 90, 600))) return { state: "none", error: "Too many tries. Wait a few minutes and reload this page." };
  try {
    const claimed = await claimSignup(driver, { id: user.id, email: user.email, emailConfirmed: true });
    if (!claimed) {
      const spaces = await listWorkspaces(driver, user.id);
      return spaces[0] ? { state: "ready", slug: spaces[0].slug } : { state: "none" };
    }
    const status = await advanceProvisioning(provisionDeps(), claimed.tenantId, { budgetMs: 12_000 });
    if (status.state !== "ready") return { state: status.state, error: status.error };
    const slug = await withPlatform(driver, async (q) => (await q.query<{ slug: string }>("select slug from public.tenants where id = $1", [claimed.tenantId])).rows[0]?.slug);
    return { state: "ready", slug };
  } catch (e) {
    if (e instanceof UserError) return { state: "none", error: e.message };
    // Settings missing on the server, or the provider unreachable: say so plainly, keep the detail out of the page.
    console.error("setup failed:", (e as Error).message.replace(/postgres(ql)?:\/\/\S+/g, "[connection]"));
    return { state: "none", error: "We could not finish setting up your workspace just now. Try again in a minute." };
  }
}

/** For a signed-in person who has no waiting sign-up (for example they were invited elsewhere first) and wants their own company. */
export async function createOrganizationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const values = Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string"));
  if (!user.email || !user.email_confirmed_at) return { error: "Confirm your email address first.", values };
  if (!(await allowShared(getDriver(), `setup-form:${user.id}`, 10, 3600))) return { error: "Too many tries. Wait a little and try again.", values };
  try {
    await recordSignup(getDriver(), parseSignup({ ...Object.fromEntries(["org_name", "contact_name", "phone", "fleet_size", "terms"].map((k) => [k, form.get(k) ?? undefined])), email: user.email }));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields, values };
    throw e;
  }
  redirect("/setup");
}
