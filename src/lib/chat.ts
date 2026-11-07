// Live chat for customer support (ADR-037): Zoho SalesIQ, on the public pages and inside the workspace. The owner pastes the widget code from SalesIQ into Admin, Settings, so nothing
// about the account is in the repository. Only two things are ever used from what the owner enters, and both are checked: the widget code (letters, digits, dash, underscore) and the
// host, which must be one of Zoho's own data-centre addresses below. The script address is built from those, never taken from a setting, so a mistyped or malicious setting cannot
// load code from anywhere else.

/** Zoho's SalesIQ data centres. The widget script is only ever loaded from one of these. */
export const CHAT_HOSTS = ["salesiq.zoho.com", "salesiq.zoho.eu", "salesiq.zoho.in", "salesiq.zoho.com.au", "salesiq.zoho.jp", "salesiq.zohocloud.ca", "salesiq.zoho.sa"] as const;
export const DEFAULT_CHAT_HOST = "salesiq.zoho.com";
const CODE_RE = /^[A-Za-z0-9_-]{20,200}$/;

export type ChatConfig = { code: string; host: string };

/** The chat setup from the operator's settings, or null when it is not set up or not valid (then no chat is loaded at all). */
export function chatConfig(s: Record<string, string | undefined>): ChatConfig | null {
  const code = s.chat_widget_code?.trim() ?? "";
  const host = (s.chat_widget_host?.trim() || DEFAULT_CHAT_HOST).toLowerCase();
  if (!CODE_RE.test(code) || !(CHAT_HOSTS as readonly string[]).includes(host)) return null;
  return { code, host };
}

/** Where the button may appear: the pages anyone can open and the signed-in workspace. Never the operator's area, the one-time-link pages, or the pages that handle a sign-in code or a password. */
const PUBLIC_CHAT_PATHS = ["/", "/pricing", "/compare", "/features", "/about", "/contact", "/signup", "/login", "/join", "/terms", "/privacy", "/forgot-password"];
export function chatAllowedOn(pathname: string): boolean {
  if (pathname === "/w" || pathname.startsWith("/w/")) return true;
  return PUBLIC_CHAT_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)));
}

/** What the support team is told about a person chatting from inside a workspace: the company, workspace, plan and state. No name, email or phone is passed on. */
export type ChatVisitor = { Company: string; Workspace: string; Plan: string; Status: string };
export const chatVisitor = (v: { company: string; slug: string; plan: string; state: string }): ChatVisitor => ({
  Company: v.company.slice(0, 120), Workspace: v.slug.slice(0, 80), Plan: v.plan.slice(0, 40), Status: v.state.slice(0, 20),
});
