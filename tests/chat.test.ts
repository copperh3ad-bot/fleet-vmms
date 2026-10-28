// Live chat (ADR-037): only a checked widget code and one of Zoho's own addresses are ever used; the button appears only where it may; the support team is told the company, workspace,
// plan and state and nothing about the person.
import { describe, expect, it } from "vitest";
import { CHAT_HOSTS, DEFAULT_CHAT_HOST, chatAllowedOn, chatConfig, chatVisitor } from "@/lib/chat";

const CODE = "siq1234567890abcdefghijklmnop";

describe("the chat setup", () => {
  it("is nothing until the owner pastes a code", () => {
    expect(chatConfig({})).toBeNull();
    expect(chatConfig({ chat_widget_code: "   " })).toBeNull();
  });

  it("uses the default Zoho address when none is chosen, and lower-cases and trims what is typed", () => {
    expect(chatConfig({ chat_widget_code: ` ${CODE} ` })).toEqual({ code: CODE, host: DEFAULT_CHAT_HOST });
    expect(chatConfig({ chat_widget_code: CODE, chat_widget_host: " SalesIQ.Zoho.EU " })).toEqual({ code: CODE, host: "salesiq.zoho.eu" });
  });

  it("accepts every Zoho data centre and nothing else as the address", () => {
    for (const host of CHAT_HOSTS) expect(chatConfig({ chat_widget_code: CODE, chat_widget_host: host })?.host).toBe(host);
    for (const host of ["evil.example.com", "salesiq.zoho.com.evil.com", "https://salesiq.zoho.com", "salesiq.zoho.com/x", "salesiq.zoho.com:8080", "zoho.com"])
      expect(chatConfig({ chat_widget_code: CODE, chat_widget_host: host })).toBeNull();
  });

  it("accepts only a code of letters, digits, dash and underscore of a sensible length", () => {
    for (const code of ["short", "a".repeat(19), "a".repeat(201), `${CODE}"`, `${CODE}<script>`, `${CODE} x`, `${CODE};alert(1)`, `${CODE}\nmore`, "https://x.example/a.js1234567890"])
      expect(chatConfig({ chat_widget_code: code }), code).toBeNull();
    expect(chatConfig({ chat_widget_code: "a".repeat(20) })).not.toBeNull();
    expect(chatConfig({ chat_widget_code: "a-b_C".repeat(8) })).not.toBeNull();
  });
});

describe("where the chat button appears", () => {
  it("on the public pages, their sub-pages, and the signed-in workspace", () => {
    for (const p of ["/", "/pricing", "/features", "/about", "/contact", "/signup", "/signup/check-email", "/login", "/join", "/terms", "/privacy", "/forgot-password", "/w", "/w/acme", "/w/acme/billing"])
      expect(chatAllowedOn(p), p).toBe(true);
  });

  it("never on the operator area, one-time links, or pages that handle a code or a password", () => {
    for (const p of ["/admin", "/admin/payments", "/q/abc123", "/o/abc123", "/invite/abc", "/reset-password", "/auth/callback", "/api/chat-config", "/welcome", "/setup", "/pricing-secret", "/wx"])
      expect(chatAllowedOn(p), p).toBe(false);
  });
});

describe("what the support team is told about a visitor", () => {
  it("is the company, workspace, plan and state, cut to length, and nothing else", () => {
    const v = chatVisitor({ company: "C".repeat(300), slug: "s".repeat(200), plan: "p".repeat(90), state: "trial".repeat(10) });
    expect(Object.keys(v).sort()).toEqual(["Company", "Plan", "Status", "Workspace"]);
    expect(v.Company).toHaveLength(120);
    expect(v.Workspace).toHaveLength(80);
    expect(v.Plan).toHaveLength(40);
    expect(v.Status).toHaveLength(20);
  });

  it("drops anything extra it is handed, such as a name or an email", () => {
    const v = chatVisitor({ company: "Acme", slug: "acme", plan: "basic", state: "active", email: "a@b.c", name: "Ann" } as never);
    expect(JSON.stringify(v)).not.toMatch(/a@b\.c|Ann/);
  });
});
