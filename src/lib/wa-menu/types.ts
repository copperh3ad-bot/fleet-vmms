import type { Driver } from "@/lib/db/types";
import type { ActiveTenant, Membership } from "@/lib/auth/can";
import type { Parsed } from "./text";

export type Candidate = { tenant: ActiveTenant; employeeId: string; userId: string; name: string };
export type Answers = Record<string, unknown>;
export type Ctx = { driver: Driver; m: Membership; me: Candidate; answers: Answers; now: Date };

/** One question of a questionnaire. `ask` may keep what it needs in `c.answers` (a list of choices, say) for `parse` to read. */
export type Step = {
  key: string;
  ask: (c: Ctx) => Promise<string>;
  parse: (raw: string, c: Ctx) => Promise<Parsed<unknown>>;
  /** The person may answer SKIP. */
  optional?: boolean;
  /** A step that takes photos (up to three), then DONE or SKIP. */
  photos?: boolean;
};

/** A questionnaire. Nothing here creates anything until the person replies YES; `submit` then calls the same function the app uses, with the sender's own role. */
export type Flow = {
  id: string;
  label: string;
  /** Whether this person may use it (permission and module switch). */
  allowed: (driver: Driver, m: Membership) => Promise<boolean>;
  steps: Step[];
  /** The answers in plain words, shown before YES. */
  summary: (a: Answers) => string;
  /** Creates the thing, and says what was made. May throw UserError, which is told to the person kindly. */
  submit: (c: Ctx) => Promise<string>;
};
