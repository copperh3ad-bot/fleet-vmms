// A joining person must now have a valid driving licence (ADR-054, ADR-096). The older tests are about invitations, sign-in names and workspaces, not licences, so they
// join with a licence typed in. tests/join-licence.test.ts does not use this and checks the rule itself.
export const LIC = { licence_no: "TEST-0001", licence_expires_on: "2099-12-31" };

type Fn = (...a: any[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
export function withLicence<T extends { acceptInvitation: Fn; acceptWithUsername: Fn }>(mod: T): T {
  return {
    ...mod,
    acceptInvitation: (d: unknown, by: unknown, user: unknown, lic?: unknown) => mod.acceptInvitation(d, by, user, lic ?? LIC),
    acceptWithUsername: (d: unknown, t: unknown, p: unknown, r: unknown, lic?: unknown) => mod.acceptWithUsername(d, t, p, r, lic ?? LIC),
  };
}
