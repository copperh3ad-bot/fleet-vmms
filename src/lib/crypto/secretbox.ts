// Encrypts the few secrets the control database must store (an organization database's connection string).
// AES-256-GCM, a fresh random IV per value, the key from the environment. The result looks like "v1.<iv>.<tag>.<data>"
// (base64url). A wrong key or a changed value fails to decrypt; it never returns garbage.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretBox = { encrypt(plain: string): string; decrypt(boxed: string): string };

/** The key is 32 random bytes, base64 encoded, in ORG_DB_KEY. Generate one with: openssl rand -base64 32 */
export function parseKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error("ORG_DB_KEY is not set.");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("ORG_DB_KEY must be 32 bytes, base64 encoded.");
  return key;
}

export function secretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("The key must be 32 bytes.");
  const b64 = (b: Buffer) => b.toString("base64url");
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return ["v1", b64(iv), b64(c.getAuthTag()), b64(data)].join(".");
    },
    decrypt(boxed) {
      const [v, iv, tag, data] = boxed.split(".");
      if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret.");
      try {
        const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
        d.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
      } catch { throw new Error("Unreadable secret."); }   // never include the value or the key in the message
    },
  };
}

let cached: SecretBox | undefined;
/** The box for this server, from the environment. */
export function envSecretBox(): SecretBox {
  return (cached ??= secretBox(parseKey(process.env.ORG_DB_KEY)));
}
