import { headers } from "next/headers";

/** Best-effort caller address for rate limiting. Behind the host's proxy the first x-forwarded-for entry is the client. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
