// Who may touch which folder of the file bucket. This used to be a database policy on the bucket; it now runs on the server (control migration 0020).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pathAllowed, type Scope } from "@/lib/supabase/blob-store";

const member: Scope = { schemas: new Set(["tenant_aaa"]), operator: false };
const operator: Scope = { schemas: new Set(), operator: true };
const nobody: Scope = { schemas: new Set(), operator: false };

describe("which folders a person may use", () => {
  it("a member uses their own organization's folder, for reading and writing", () => {
    expect(pathAllowed(member, "tenant_aaa/job_card/x.pdf", "read")).toBe(true);
    expect(pathAllowed(member, "tenant_aaa/job_card/x.pdf", "write")).toBe(true);
  });
  it("a member cannot use another organization's folder", () => {
    expect(pathAllowed(member, "tenant_bbb/job_card/x.pdf", "read")).toBe(false);
    expect(pathAllowed(member, "tenant_bbb/job_card/x.pdf", "write")).toBe(false);
  });
  it("refuses a path that climbs out of the folder", () => {
    expect(pathAllowed(member, "tenant_aaa/../tenant_bbb/x.pdf", "read")).toBe(false);
  });
  it("nobody signed in uses nothing", () => {
    expect(pathAllowed(nobody, "tenant_aaa/job_card/x.pdf", "read")).toBe(false);
  });
  it("the operator reads payment receipts and nothing else, and writes nothing", () => {
    expect(pathAllowed(operator, "tenant_aaa/billing/receipt.jpg", "read")).toBe(true);
    expect(pathAllowed(operator, "tenant_aaa/job_card/x.pdf", "read")).toBe(false);
    expect(pathAllowed(operator, "tenant_aaa/billing/receipt.jpg", "write")).toBe(false);
  });
});

describe("the bucket has no rules for browsers", () => {
  it("the migration drops every policy the bucket had for signed-in people", () => {
    const sql = readFileSync("db/control/0020_storage_server_only.sql", "utf8");
    for (const p of ["attachments_read", "attachments_insert", "attachments_delete", "attachments_operator_read"]) expect(sql).toContain(`'${p}'`);
  });
});
