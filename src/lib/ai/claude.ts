// The one place the app talks to Claude (ADR-034). Reads a workshop's estimate or invoice (PDF or photo) and returns a checked DRAFT for a person to
// confirm. It is given only the document and the few facts needed to read it (the job number, the kind asked for, the currency, and, for an invoice, the
// approved estimate's lines): no names of people, no vehicle owner, no other job. It has no tools and cannot act; its answer is data that
// src/lib/ai/document.ts checks. The key is read from the server's environment by the SDK, never logged, never sent to a browser.
import Anthropic from "@anthropic-ai/sdk";
import { checkPolicyDraft, POLICY_PROMPT, POLICY_SCHEMA, type PolicyDraft } from "./policy-draft";
import { ADVICE_PROMPT, ADVICE_SCHEMA, checkAdvice, type QuoteAdvice } from "./quote-advice";
import { checkJobCardDraft, JOBCARD_PROMPT, JOBCARD_SCHEMA, type JobCardDraft } from "./jobcard-draft";
import { checkDraft, DOCUMENT_SCHEMA, SYSTEM_PROMPT, type Draft, type Expectation } from "./document";

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY && process.env.AI_DOCUMENT_READING !== "off";
/**
 * The cheapest current model that reads a PDF or a photo (Claude Haiku 5.5, $0.10 in / $0.50 out per million tokens), because copying printed figures into a
 * form that a person then checks does not need a larger model. The owner can set another in Netlify (AI_MODEL) if readings turn out to need one:
 * the share of drafts a person saved unchanged is recorded (ai_actions.outcome) so that is a measured choice, not a guess.
 */
export const aiModel = () => process.env.AI_MODEL?.trim() || "claude-haiku-5-5";

export const MAX_AI_FILES = 3;
export const MAX_AI_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type AiFile = { name: string; mime: string; bytes: Uint8Array };
export type ApprovedLine = { id: string; description: string; qty: string; unit_cost: string };
export type ReadRequest = { jobNo: string; kind: "quotation" | "invoice"; currency: string; approvedLines: ApprovedLine[]; files: AiFile[] };
export type ReadResult =
  | ({ status: "ok"; draft: Draft } & Usage)
  | ({ status: "unreadable" | "refused" | "failed"; reason: string } & Usage);
export type Usage = { model: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
/** Token counts from a reply, including what the cache wrote and what it served (recorded per call in ai_actions so the cache's effect is measured). */
export const usageOf = (model: string, res: { usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } }): Usage => ({
  model, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0, cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0, cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0,
});
export const noUsage = (model: string): Usage => ({ model, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });

/** The one call, passed in so tests need no network. The real one is the SDK's beta messages create. */
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
let sdk: Anthropic | null = null;
export const realCreate: CreateMessage = (p) => (sdk ??= new Anthropic({ maxRetries: 2, timeout: 120_000 })).beta.messages.create(p);

export function usableFiles(files: AiFile[]): { use: AiFile[]; skipped: string[] } {
  const use: AiFile[] = [], skipped: string[] = [];
  let total = 0;
  for (const f of files) {
    const ok = f.mime === "application/pdf" || IMAGE_TYPES.has(f.mime);
    if (!ok) { skipped.push(`${f.name}: only PDF and ordinary photos can be read (not ${f.mime || "this type"})`); continue; }
    if (use.length >= MAX_AI_FILES || total + f.bytes.length > MAX_AI_BYTES) { skipped.push(`${f.name}: too many or too large to read together`); continue; }
    total += f.bytes.length;
    use.push(f);
  }
  return { use, skipped };
}

export async function readDocument(req: ReadRequest, create: CreateMessage = realCreate): Promise<ReadResult> {
  const model = aiModel();
  const { use, skipped } = usableFiles(req.files);
  if (use.length === 0) return { status: "unreadable", reason: skipped[0] ?? "There is no file to read.", ...noUsage(model) };

  const blocks: Anthropic.Beta.BetaContentBlockParam[] = use.map((f): Anthropic.Beta.BetaContentBlockParam => {
    const data = Buffer.from(f.bytes).toString("base64");
    return f.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: f.mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } };
  });
  // Prompt caching (ADR-034): the fixed instructions are one breakpoint (a model only caches a prefix above its minimum size, so on Haiku this small prompt is not cached and the file is what saves money); the last file is the other, so pressing "read" again on the same document
  // (after a correction, or by a second person) reuses it. The job's own facts come after both, so they never break the cached part.
  const lastFile = blocks[blocks.length - 1] as { cache_control?: { type: "ephemeral" } };
  lastFile.cache_control = { type: "ephemeral" };
  blocks.push({
    type: "text",
    text: JSON.stringify({
      job_card: req.jobNo, asked_for: req.kind === "quotation" ? "estimate" : "invoice", company_currency: req.currency,
      approved_estimate_lines: req.kind === "invoice" ? req.approvedLines.map((l) => ({ id: l.id, description: l.description, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })) : [],
    }),
  });

  try {
    const res = await create({
      model, max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: DOCUMENT_SCHEMA as unknown as Record<string, unknown> } },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: blocks }],
    });
    const usage = usageOf(model, res);
    if (res.stop_reason === "refusal") return { status: "refused", reason: "The AI declined to read this file. Type the figures in from it.", ...usage };
    if (res.stop_reason === "max_tokens") return { status: "failed", reason: "The document was too long to read in one go. Type the figures in from it.", ...usage };
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return { status: "failed", reason: "The AI's answer could not be read. Type the figures in from the file.", ...usage }; }
    const draft = checkDraft(raw, { kind: req.kind, currency: req.currency, approvedLineIds: req.approvedLines.map((l) => l.id) } satisfies Expectation);
    for (const s of skipped) draft.warnings.push(`Not read: ${s}.`);
    if (!draft.readable) return { status: "unreadable", reason: draft.warnings[0] ?? "The file could not be read well enough to take figures from.", ...usage };
    return { status: "ok", draft, ...usage };
  } catch (e) {
    // Never the key, the file or the answer: only the kind of failure.
    const why = e instanceof Anthropic.RateLimitError ? "The AI service is busy. Try again in a minute." : e instanceof Anthropic.APIError ? `The AI service refused the request (${e.status}).` : "The AI service could not be reached.";
    return { status: "failed", reason: why, ...noUsage(model) };
  }
}

export type PolicyResult = ({ status: "ok"; draft: PolicyDraft } & Usage) | ({ status: "unreadable" | "refused" | "failed"; reason: string } & Usage);

/** The one model call for a policy. `create` is passed in so tests need no network. */
export async function readPolicyFile(file: AiFile, create: CreateMessage = realCreate): Promise<PolicyResult> {
  const model = aiModel();
  const { use, skipped } = usableFiles([file]);
  if (use.length === 0) return { status: "unreadable", reason: skipped[0] ?? "There is no file to read.", ...noUsage(model) };
  const data = Buffer.from(use[0].bytes).toString("base64");
  const block: Anthropic.Beta.BetaContentBlockParam = use[0].mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data }, cache_control: { type: "ephemeral" } }
    : { type: "image", source: { type: "base64", media_type: use[0].mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data }, cache_control: { type: "ephemeral" } };
  try {
    const res = await create({
      model, max_tokens: 8000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: POLICY_SCHEMA as unknown as Record<string, unknown> } },
      system: [{ type: "text", text: POLICY_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [block, { type: "text", text: "List the rules in this policy." }] }],
    });
    const usage = usageOf(model, res);
    if (res.stop_reason === "refusal") return { status: "refused", reason: "The AI declined to read this file. Use \"Read this policy\", or set the rules by hand.", ...usage };
    if (res.stop_reason === "max_tokens") return { status: "failed", reason: "The policy was too long to read in one go. Use \"Read this policy\", or set the rules by hand.", ...usage };
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return { status: "failed", reason: "The AI's answer could not be read. Try again, or use \"Read this policy\".", ...usage }; }
    const draft = checkPolicyDraft(raw);
    for (const s of skipped) draft.warnings.push(`Not read: ${s}.`);
    if (!draft.readable) return { status: "unreadable", reason: draft.warnings[0] ?? "The file could not be read well enough to take rules from.", ...usage };
    return { status: "ok", draft, ...usage };
  } catch (e) {
    const why = e instanceof Anthropic.RateLimitError ? "The AI service is busy. Try again in a minute." : e instanceof Anthropic.APIError ? `The AI service refused the request (${e.status}).` : "The AI service could not be reached.";
    return { status: "failed", reason: why, ...noUsage(model) };
  }
}

export type JobCardReadResult = ({ status: "ok"; draft: JobCardDraft } & Usage) | ({ status: "unreadable" | "refused" | "failed"; reason: string } & Usage);

/**
 * The one model call for a job card raised by WhatsApp (ADR-061). It gets the sender's message, up to three photos, and, on a correction, the draft it made before: nothing about
 * the company, its people or its other vehicles. `create` is passed in so tests need no network. Only ordinary photos are read; a PDF or anything else is left out.
 */
export async function readJobCardMessage(req: { text: string; previous: JobCardDraft | null; files: AiFile[] }, create: CreateMessage = realCreate): Promise<JobCardReadResult> {
  const model = aiModel();
  const photos = req.files.filter((f) => IMAGE_TYPES.has(f.mime));
  const { use, skipped } = usableFiles(photos);
  const text = req.text.trim().slice(0, 2000);
  if (text.length < 3 && use.length === 0) return { status: "unreadable", reason: "There is nothing to read.", ...noUsage(model) };
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = use.map((f): Anthropic.Beta.BetaContentBlockParam => ({
    type: "image", source: { type: "base64", media_type: f.mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data: Buffer.from(f.bytes).toString("base64") },
  }));
  // Prompt caching: the photos are the other breakpoint, so a correction ("no, the left tyre") that sends the same photos again reuses them. The message and the
  // previous draft come after it because they change on every call.
  if (blocks.length > 0) (blocks[blocks.length - 1] as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" };
  blocks.push({ type: "text", text: JSON.stringify({ message: text, previous_draft: req.previous, photos: use.length }) });
  try {
    const res = await create({
      model, max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: JOBCARD_SCHEMA as unknown as Record<string, unknown> } },
      system: [{ type: "text", text: JOBCARD_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: blocks }],
    });
    const usage = usageOf(model, res);
    if (res.stop_reason === "refusal") return { status: "refused", reason: "I could not read that message. Please raise the job card in the app.", ...usage };
    if (res.stop_reason === "max_tokens") return { status: "failed", reason: "That message was too long to read. Please send it shorter, or raise the job card in the app.", ...usage };
    const answer = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let raw: unknown;
    try { raw = JSON.parse(answer); } catch { return { status: "failed", reason: "I could not understand that. Please try again, or raise the job card in the app.", ...usage }; }
    const draft = checkJobCardDraft(raw);
    for (const s of skipped) draft.warnings.push(`Not read: ${s}.`);
    if (!draft.readable) return { status: "unreadable", reason: draft.warnings[0] ?? "That does not read as a vehicle problem.", ...usage };
    return { status: "ok", draft, ...usage };
  } catch (e) {
    // Never the key, the message or the photos: only the kind of failure.
    const why = e instanceof Anthropic.RateLimitError ? "The AI service is busy. Please try again in a minute." : "I could not read that just now. Please try again, or raise the job card in the app.";
    return { status: "failed", reason: why, ...noUsage(model) };
  }
}

export type AdviceResult = ({ status: "ok"; advice: QuoteAdvice } & Usage) | ({ status: "unreadable" | "refused" | "failed"; reason: string } & Usage);

/**
 * The one model call for comparing a trip's quotes (ADR-080). It gets the trip's route and needs and each option's quote, rate cards and history under a letter: no
 * provider names, no people. It has no tools and cannot act; the answer is checked by checkAdvice and shown as advice. `create` is passed in so tests need no network.
 */
export async function adviseQuotes(input: unknown, labels: string[], create: CreateMessage = realCreate): Promise<AdviceResult> {
  const model = aiModel();
  try {
    const res = await create({
      model, max_tokens: 3000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: ADVICE_SCHEMA as unknown as Record<string, unknown> } },
      system: [{ type: "text", text: ADVICE_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(input) }] }],
    });
    const usage = usageOf(model, res);
    if (res.stop_reason === "refusal") return { status: "refused", reason: "The AI declined to compare these quotes. Compare them by hand.", ...usage };
    if (res.stop_reason === "max_tokens") return { status: "failed", reason: "The comparison was too long to finish. Try again, or compare by hand.", ...usage };
    const answer = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let raw: unknown;
    try { raw = JSON.parse(answer); } catch { return { status: "failed", reason: "The AI's answer could not be read. Try again, or compare by hand.", ...usage }; }
    const advice = checkAdvice(raw, labels);
    if (!advice) return { status: "unreadable", reason: "The AI gave no usable comparison. Try again, or compare by hand.", ...usage };
    return { status: "ok", advice, ...usage };
  } catch (e) {
    const why = e instanceof Anthropic.RateLimitError ? "The AI service is busy. Try again in a minute." : e instanceof Anthropic.APIError ? `The AI service refused the request (${e.status}).` : "The AI service could not be reached.";
    return { status: "failed", reason: why, ...noUsage(model) };
  }
}
