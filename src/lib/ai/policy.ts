// The AI reads a company's maintenance policy (ADR-043). Same rules as reading a workshop document (ADR-034): it returns a DRAFT of the rules it found, each with
// the sentence it came from; the server checks every value against what the system would accept; a person ticks what is right and applies it. The policy
// decides who pays for repairs, so nothing is applied by the AI and nothing is applied from the browser's values: the stored findings are applied.
// The reading is stored as the policy's reading (policy_readings, source 'ai'), so the review screen and the apply step are the ones the plain reader uses.
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { policyFile, type ReadableStore } from "@/lib/master/policy-reading";
import { allowShared } from "@/lib/rate-limit";
import { tenantPlan } from "@/lib/billing/plans";
import { aiConfigured, readPolicyFile, type CreateMessage } from "./claude";
import { AI_READS_PER_PERSON_PER_HOUR, aiDocumentsEnabled } from "./service";

const HOUR = 3600, DAY = 86_400;

/** Is the "Read with AI" button offered here? The server has the AI, the plan includes it and the administrator has switched it on. */
export { aiOffered as policyAiOffered } from "./service";

/**
 * Reads the policy's file with the AI and stores the result as the policy's reading, replacing an earlier one. Same gates as reading a workshop document:
 * Pro plan, the administrator's switch, the trial's reading allowance, and the organization's and the person's limits. Every use is logged.
 */
export async function readPolicyWithAi(driver: Driver, store: ReadableStore, m: Membership, policyId: string, create?: CreateMessage): Promise<{ id: string; findings: number }> {
  if (!aiConfigured()) throw new UserError("Reading with AI is not switched on for this service yet.");
  const file = await authorized(driver, m, "policy.manage", async (q) => {
    const path = await policyFile(q, m, policyId);
    const a = (await q.query<{ file_name: string; mime_type: string | null }>("select file_name, mime_type from attachments where storage_path = $1", [path])).rows[0];
    return { path, name: a?.file_name ?? "policy", mime: a?.mime_type ?? "" };
  });
  const plan = await tenantPlan(driver, m.tenantId);
  if (!plan.aiDocuments) throw new UserError("Reading with AI is part of the Pro plan. Use \"Read this policy\", or ask your administrator about upgrading in Billing.");
  if (!(await aiDocumentsEnabled(driver, m.tenantId))) throw new UserError("Your administrator has not switched on reading documents with AI. Use \"Read this policy\" instead.");
  if (plan.aiTrialReads !== null) {
    const used = await authorized(driver, m, "policy.manage", async (q) => Number((await q.query<{ n: string }>("select count(*)::text n from ai_actions where status <> 'failed'")).rows[0].n));
    if (used >= plan.aiTrialReads) throw new UserError(`Your trial includes ${plan.aiTrialReads} readings with AI and they are used up. Pay for Pro in Billing to keep going, or use "Read this policy".`);
  }
  const [orgOk, personOk] = await Promise.all([allowShared(driver, `ai-read-org:${m.tenantId}`, plan.aiPerDay, DAY), allowShared(driver, `ai-read-user:${m.userId}`, AI_READS_PER_PERSON_PER_HOUR, HOUR)]);
  if (!orgOk || !personOk) throw new UserError("The limit for reading documents with AI has been reached for now. Try again later, or use \"Read this policy\".");

  const bytes = await store.get(file.path).catch(() => null);
  if (!bytes) throw new UserError("The file could not be fetched. Try again.");
  const r = await readPolicyFile({ name: file.name, mime: file.mime, bytes }, create);
  const draft = r.status === "ok" ? r.draft : null;

  const actionId = await authorized(driver, m, "policy.manage", async (q) => {
    const id = (await q.query<{ id: string }>(
      `insert into ai_actions(kind, policy_id, model, status, reason, draft, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, requested_by)
       values ('policy_read', $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10) returning id`,
      [policyId, r.model, r.status, r.status === "ok" ? null : r.reason, draft ? JSON.stringify(draft) : null, r.inputTokens, r.outputTokens, r.cacheWriteTokens, r.cacheReadTokens, m.userId])).rows[0].id;
    if (draft) {     // a failed reading is logged but leaves the earlier reading, if any, as it was
      await q.query("delete from policy_readings where policy_id = $1", [policyId]);
      await q.query(
        `insert into policy_readings(policy_id, status, file_kind, pages_total, pages_done, findings, error, started_by, source, ai_action_id)
         values ($1, 'ready', $2, 1, 1, $3::jsonb, $4, $5, 'ai', $6)`,
        [policyId, file.mime === "application/pdf" ? "pdf-text" : "image", JSON.stringify(draft.findings), draft.warnings.length ? draft.warnings.join(" ") : null, m.userId, id]);
    }
    return id;
  });
  if (!draft) throw new UserError((r as { reason: string }).reason);
  return { id: actionId, findings: draft.findings.length };
}
