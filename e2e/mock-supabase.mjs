// A local stand-in for the parts of Supabase the app uses: email+password sign-in with email confirmation (PKCE), and file storage.
// For the end-to-end beta test only. It is NOT Supabase: it does not test Supabase's rules (row security on storage, email delivery).
import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.MOCK_PORT ?? 54399);
const KEY = crypto.randomBytes(32);                        // signs the test tokens; new for every run
const users = new Map();      // email -> user
const codes = new Map();      // pkce code -> email
const refresh = new Map();    // refresh token -> email
const files = new Map();      // bucket/path -> { bytes, type }
const signed = new Map();     // token -> key
const log = [];
let autoconfirm = false;

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const mac = (s) => crypto.createHmac("sha256", KEY).update(s).digest("base64url");
const sign = (payload) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload); return `${h}.${p}.${mac(`${h}.${p}`)}`; };
const verify = (t) => {
  const [h, p, s] = String(t ?? "").split(".");
  if (!s || mac(`${h}.${p}`) !== s) return null;
  const pl = JSON.parse(Buffer.from(p, "base64url").toString());
  return pl.exp * 1000 > Date.now() ? pl : null;
};
const publicUser = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.confirmed ? u.confirmedAt : null, phone: "", confirmation_sent_at: u.createdAt,
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: u.meta ?? {}, identities: [], created_at: u.createdAt, updated_at: u.createdAt, is_anonymous: false });
function session(u) {
  const now = Math.floor(Date.now() / 1000), exp = now + 3600;
  const rt = crypto.randomBytes(12).toString("hex"); refresh.set(rt, u.email);
  const access = sign({ iss: "http://127.0.0.1/auth/v1", sub: u.id, aud: "authenticated", role: "authenticated", email: u.email, iat: now, exp, session_id: crypto.randomUUID(), app_metadata: { provider: "email" }, user_metadata: u.meta ?? {}, is_anonymous: false });
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: rt, user: publicUser(u) };
}
const send = (res, code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "access-control-allow-origin": "*" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });
const err = (res, code, errcode, msg) => send(res, code, { code, error_code: errcode, error: errcode, error_description: msg, msg, message: msg });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`), path = url.pathname;
  const raw = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : await readBody(req);
  const json = () => { try { return JSON.parse(raw.toString() || "{}"); } catch { return {}; } };
  if (req.method === "OPTIONS") return send(res, 204, "");
  log.push(`${req.method} ${path}`);

  // ---- test controls
  if (path === "/__test/confirm") {
    const u = users.get(String(url.searchParams.get("email")).toLowerCase());
    if (!u) return send(res, 404, { error: "no such user" });
    u.confirmed = true; u.confirmedAt = new Date().toISOString();
    const code = crypto.randomBytes(16).toString("hex"); codes.set(code, u.email);
    return send(res, 200, { code, id: u.id });
  }
  if (path === "/__test/user") { const u = users.get(String(url.searchParams.get("email")).toLowerCase()); return u ? send(res, 200, { id: u.id, confirmed: u.confirmed }) : send(res, 404, {}); }
  if (path === "/__test/autoconfirm") { autoconfirm = url.searchParams.get("on") === "1"; return send(res, 200, { autoconfirm }); }
  if (path === "/__test/log") return send(res, 200, log.slice(-200));
  if (path === "/__test/files") return send(res, 200, [...files.keys()]);

  // ---- auth
  if (path === "/auth/v1/signup" && req.method === "POST") {
    const b = json(), email = String(b.email ?? "").toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return err(res, 422, "validation_failed", "Unable to validate email address: invalid format");
    if (String(b.password ?? "").length < 6) return err(res, 422, "weak_password", "Password should be at least 6 characters.");
    const old = users.get(email);
    if (old) return send(res, 200, publicUser({ ...old, id: crypto.randomUUID(), confirmed: false }));      // like Supabase with email confirmation on: no error, no hint
    const u = { id: crypto.randomUUID(), email, password: b.password, meta: b.data ?? {}, confirmed: autoconfirm, confirmedAt: autoconfirm ? new Date().toISOString() : null, createdAt: new Date().toISOString() };
    users.set(email, u);
    return send(res, 200, autoconfirm ? session(u) : publicUser(u));
  }
  if (path === "/auth/v1/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type"), b = json();
    if (grant === "password") {
      const u = users.get(String(b.email ?? "").toLowerCase());
      if (!u || u.password !== b.password) return err(res, 400, "invalid_credentials", "Invalid login credentials");
      if (!u.confirmed) return err(res, 400, "email_not_confirmed", "Email not confirmed");
      return send(res, 200, session(u));
    }
    if (grant === "refresh_token") { const e = refresh.get(b.refresh_token); const u = e && users.get(e); return u ? send(res, 200, session(u)) : err(res, 400, "refresh_token_not_found", "Invalid Refresh Token"); }
    if (grant === "pkce") { const e = codes.get(b.auth_code); const u = e && users.get(e); if (!u) return err(res, 400, "flow_state_not_found", "invalid flow state, no valid flow state found"); codes.delete(b.auth_code); return send(res, 200, session(u)); }
    return err(res, 400, "unsupported_grant_type", "unsupported grant");
  }
  if (path === "/auth/v1/user") {
    const pl = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    const u = pl && [...users.values()].find((x) => x.id === pl.sub);
    return u ? send(res, 200, publicUser(u)) : err(res, 401, "bad_jwt", "invalid JWT");
  }
  if (path === "/auth/v1/logout") return send(res, 204, "");
  if (path === "/auth/v1/resend") return send(res, 200, {});

  // ---- storage
  const m = path.match(/^\/storage\/v1\/object\/(?:authenticated\/|sign\/)?([^/]+)\/(.+)$/);
  if (path.startsWith("/storage/v1/object/sign/") && req.method === "POST" && m) {
    const key = `${m[1]}/${decodeURIComponent(m[2])}`;
    if (!files.has(key)) return err(res, 400, "not_found", "Object not found");
    const token = crypto.randomBytes(10).toString("hex"); signed.set(token, key);
    return send(res, 200, { signedURL: `/object/sign/${m[1]}/${m[2]}?token=${token}` });
  }
  if (path.startsWith("/storage/v1/object/sign/") && req.method === "GET" && m) {
    const key = signed.get(url.searchParams.get("token") ?? ""); const f = key && files.get(key);
    return f ? send(res, 200, f.bytes, f.type) : err(res, 400, "not_found", "Object not found");
  }
  if (req.method === "POST" && path.startsWith("/storage/v1/object/") && m) {
    const key = `${m[1]}/${decodeURIComponent(m[2])}`;
    if (files.has(key) && req.headers["x-upsert"] !== "true") return send(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    files.set(key, { bytes: raw, type: String(req.headers["content-type"] ?? "application/octet-stream") });
    return send(res, 200, { Id: crypto.randomUUID(), Key: key });
  }
  if (req.method === "DELETE" && /^\/storage\/v1\/object\/[^/]+$/.test(path)) {
    const bucket = path.split("/").pop(); for (const p of json().prefixes ?? []) files.delete(`${bucket}/${p}`);
    return send(res, 200, []);
  }
  if (req.method === "GET" && path.startsWith("/storage/v1/object/") && m) {
    const f = files.get(`${m[1]}/${decodeURIComponent(m[2])}`);
    return f ? send(res, 200, f.bytes, f.type) : err(res, 404, "not_found", "Object not found");
  }
  return err(res, 404, "not_found", `mock has no ${req.method} ${path}`);
}).listen(PORT, "127.0.0.1", () => console.log(`mock supabase on ${PORT}`));
