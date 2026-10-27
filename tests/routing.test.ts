import { describe, expect, it } from "vitest";
import { guardDecision, postLoginDestination } from "@/lib/auth/routing";

describe("guard", () => {
  it("sends signed-out visitors to /login", () => {
    for (const p of ["/w/demo-fleet", "/w/new-org/billing", "/api/anything", "/login/x", "/setup", "/admin", "/admin/payments", "/signup/anything", "/auth", "/auth/callback/x", "/terms/x", "/Signup"])
      expect(guardDecision(p, false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("leaves only the named public pages open when signed out (ADR-014)", () => {
    for (const p of ["/", "/login", "/forgot-password", "/about", "/contact", "/api/health", "/signup", "/signup/check-email", "/terms", "/privacy", "/auth/callback", "/robots.txt", "/sitemap.xml", "/llms.txt", "/features", "/.well-known/security.txt", "/api/auth/send-email", "/api/inbound/email", "/api/chat-config", "/vehicle-sheet.xlsx", "/vehicle-sheet.csv"])
      expect(guardDecision(p, false)).toEqual({ action: "next" });
  });
  it("keeps the choose-a-new-password page behind a session (ADR-019)", () => {
    for (const p of ["/reset-password", "/reset-password/x", "/forgot-password/x", "/Forgot-Password"])
      expect(guardDecision(p, false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("opens the odometer link path, and only that exact shape (ADR-006)", () => {
    const tok = "A".repeat(43);
    expect(guardDecision(`/o/${tok}`, false)).toEqual({ action: "next" });
    for (const p of ["/o", "/o/", "/o/short", `/o/${tok}/x`, `/o/${tok}A`, `/o/${"A".repeat(42)}.`, `/x/o/${tok}`, `/w/demo/o/${tok}`])
      expect(guardDecision(p, false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("opens the invitation page path, and only that exact shape (ADR-012)", () => {
    const tok = "B".repeat(43);
    expect(guardDecision(`/invite/${tok}`, false)).toEqual({ action: "next" });
    for (const p of ["/invite", "/invite/", "/invite/short", `/invite/${tok}/x`, `/invite/${tok}B`, `/x/invite/${tok}`, `/w/demo/invite/${tok}`, `/Invite/${tok}`])
      expect(guardDecision(p, false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("opens the workshop estimate link path, and only that exact shape (ADR-030)", () => {
    const tok = "C".repeat(43);
    expect(guardDecision(`/q/${tok}`, false)).toEqual({ action: "next" });
    for (const p of ["/q", "/q/", "/q/short", `/q/${tok}/x`, `/q/${tok}C`, `/x/q/${tok}`, `/w/demo/q/${tok}`, `/Q/${tok}`])
      expect(guardDecision(p, false)).toEqual({ action: "redirect", to: "/login" });
  });
  it("lets signed-in users through", () => expect(guardDecision("/w/demo-fleet", true)).toEqual({ action: "next" }));
});

describe("post-login destination", () => {
  it("one workspace goes straight in", () => expect(postLoginDestination([{ slug: "demo-fleet" }])).toBe("/w/demo-fleet"));
  it("none or several stay on the chooser", () => {
    expect(postLoginDestination([])).toBeNull();
    expect(postLoginDestination([{ slug: "a" }, { slug: "b" }])).toBeNull();
  });
});
