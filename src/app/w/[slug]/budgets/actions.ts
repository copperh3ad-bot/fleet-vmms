"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { copyBudgetsForward, saveBudget } from "@/lib/control/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function saveBudgetAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveBudget(getDriver(), m, Object.fromEntries(["id", "vehicle_id", "period_start", "period_end", "amount", "reason"].map((k) => [k, str(form, k)])));
    return str(form, "id") ? "Budget changed." : "Budget added.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/budgets`); }
  return { ...state, values: typed(form) };
}

export async function copyBudgetsAction(slug: string, year: number, _prev: FormState, _form: FormData): Promise<FormState> {
  void _form;
  const state = await runAction(slug, async (m) => {
    const r = await copyBudgetsForward(getDriver(), m, year);
    return r.created === 0 && r.skipped === 0 ? `No budgets in ${year} to copy.` : `Copied ${r.created}${r.skipped ? `, skipped ${r.skipped} that already exist` : ""}.`;
  });
  if (state.ok) refresh();
  return state;
}
