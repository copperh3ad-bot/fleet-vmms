import { describe, expect, it } from "vitest";
import { readJobCardMessage, readDocument, usageOf, type CreateMessage } from "@/lib/ai/claude";

const jpeg = (n: number) => ({ name: `p${n}.jpg`, mime: "image/jpeg", bytes: new Uint8Array([1, 2, 3, n]) });
const capture = () => {
  const calls: Parameters<CreateMessage>[0][] = [];
  const create: CreateMessage = async (p) => {
    calls.push(p);
    return { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 3 } } as never;
  };
  return { calls, create };
};

describe("prompt caching on every model call", () => {
  it("reads the cache counts from a reply", () => {
    expect(usageOf("m", { usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 7, cache_read_input_tokens: 3 } })).toEqual({ model: "m", inputTokens: 10, outputTokens: 5, cacheWriteTokens: 7, cacheReadTokens: 3 });
    expect(usageOf("m", {}).cacheReadTokens).toBe(0);
  });

  it("job card: system prompt and the last photo are breakpoints; the changing message is not", async () => {
    const { calls, create } = capture();
    await readJobCardMessage({ text: "front left tyre is flat", previous: null, files: [jpeg(1), jpeg(2)] }, create);
    const content = calls[0].messages[0].content as { type: string; cache_control?: unknown }[];
    expect((calls[0].system as { cache_control?: unknown }[])[0].cache_control).toBeTruthy();
    expect(content[0].cache_control).toBeUndefined();
    expect(content[1].cache_control).toBeTruthy();
    expect(content[2].type).toBe("text");
    expect(content[2].cache_control).toBeUndefined();
  });

  it("document: system prompt and the last file are breakpoints; the job facts come after", async () => {
    const { calls, create } = capture();
    await readDocument({ jobNo: "JC-1", kind: "quotation", currency: "PKR", approvedLines: [], files: [{ name: "a.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }] }, create);
    const content = calls[0].messages[0].content as { type: string; cache_control?: unknown }[];
    expect((calls[0].system as { cache_control?: unknown }[])[0].cache_control).toBeTruthy();
    expect(content[0].cache_control).toBeTruthy();
    expect(content[1].cache_control).toBeUndefined();
  });
});
