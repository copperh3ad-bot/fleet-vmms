// The invitation email must always carry the real link, also when WhatsApp delivers it and the administrator's screen is kept blank (QA report: "Create my account" had href="").
import { describe, expect, it } from "vitest";
import { inviteLinks } from "@/lib/admin/invite-links";
import { buildInvitationMail } from "@/lib/email/invitation";

const base = { to: "ali@example.com", fullName: "Ali Raza", orgName: "Delta Textiles", siteUrl: "https://www.fleetotg.com", days: 7 };

describe("the two copies of an invitation link", () => {
  it("the email always has the link; the screen has it only when the app did not send it by WhatsApp", () => {
    expect(inviteLinks("https://www.fleetotg.com", "tok123", false)).toEqual({ forEmail: "https://www.fleetotg.com/invite/tok123", shown: "https://www.fleetotg.com/invite/tok123" });
    expect(inviteLinks("https://www.fleetotg.com", "tok123", true)).toEqual({ forEmail: "https://www.fleetotg.com/invite/tok123", shown: "" });
    expect(inviteLinks("https://www.fleetotg.com/", "tok123", true).forEmail).toBe("https://www.fleetotg.com/invite/tok123");
  });

  it("an email built from the real link has it in the button and in the plain text", () => {
    const m = buildInvitationMail({ ...base, url: inviteLinks("https://www.fleetotg.com", "tok123", true).forEmail });
    expect(m.html).toContain('href="https://www.fleetotg.com/invite/tok123"');
    expect(m.text).toContain("Create my account: https://www.fleetotg.com/invite/tok123");
  });

  it("refuses to build an invitation email with no link, so the screen says the email did not go instead of sending a dead button", () => {
    expect(() => buildInvitationMail({ ...base, url: "" })).toThrow(/link missing/);
    expect(() => buildInvitationMail({ ...base, url: "javascript:alert(1)" })).toThrow(/link missing/);
  });
});
