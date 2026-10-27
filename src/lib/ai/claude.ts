// The one place the app talks to Claude (ADR-034). Reads a workshop's estimate or invoice (PDF or photo) and returns a checked DRAFT for a person to
// confirm. It is given only the document and the few facts needed to read it (the job number, the kind asked for, the currency, and, for an invoice, the
// approved estimate's lines): no names of people, no vehicle owner, no other job. It has no tools and cannot act; its answer is data that
// src/lib/ai/document.ts checks. The key is read from the server's environment by the SDK, never logged, never sent to a browser.
import Anthropic from "@anthropic-ai/sdk";
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
type Usage = { model: string; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };
const noUsage = (model: string): Usage => ({ model, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 });

/** The one call, passed in so tests need no network. The real one is the SDK's beta messages create. */
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
let sdk: Anthropic | null = null;
const realCreate: CreateMessage = (p) => (sdk ??= new Anthropic({ maxRetries: 2, timeout: 120_000 })).beta.messages.create(p);

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
  // Prompt caching (ADR-034): the fixed instructions are one breakpoint; the last file is the other, so pressing "read" again on the same document
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
    const usage: Usage = { model, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0, cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0, cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0 };
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
