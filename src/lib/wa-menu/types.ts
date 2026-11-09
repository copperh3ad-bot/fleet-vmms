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
  /** True when an earlier answer makes this question unnecessary: it is not asked, its answer is empty, and BACK passes over it. */
  skip?: (c: Ctx) => boolean;
  /** A step that takes photos (up to three), then DONE or SKIP. */
  photos?: boolean;
  /** The options to show as a tappable list (at most 9, or 10 when it cannot be skipped). Read after `ask`, so a list built there can be returned. The text reply still works. */
  choices?: (c: Ctx) => { id: string; label: string }[] | null;
};

/** A questionnaire. Nothing here creates anything until the person replies YES; `submit` then calls the same function the app uses, with the sender's own role. */
export type Flow = {
  id: string;
  label: string;
  /** The name on a tappable row, at most 24 characters; `label` is shown under it. */
  short?: string;
  /** Whether this person may use it (permission and module switch). */
  allowed: (driver: Driver, m: Membership) => Promise<boolean>;
  steps: Step[];
  /**
   * A WhatsApp form (ADR-084) that asks everything at once, so the request costs about one message from the sender. It is used when the environment names the form
   * (`env` holds Meta's form id); otherwise, and whenever the person replies TEXT, the questions above are asked one at a time. The answers come back as plain values and are read
   * (and checked again) by `read`. `after` names chat steps still asked after the form, for what a form cannot take (photos). With none, the request is sent as soon as the form is.
   */
  form?: {
    env: string; screen: string; cta: string; body: string; after?: string[];
    read: (answers: Record<string, string>, c: Ctx) => Promise<{ ok: true; answers: Answers } | { ok: false; error: string }>;
  };
  /** The answers in plain words, shown before YES. */
  summary: (a: Answers) => string;
  /** Creates the thing, and says what was made. May throw UserError, which is told to the person kindly. */
  submit: (c: Ctx) => Promise<string>;
};
