// The operator's Settings assistant (ADR-083). It proposes; the operator applies. `askSettingsAssistant` asks the AI and returns its checked proposals without changing anything.
// `applySettingChanges` is the only way a proposal becomes a change, and it re-checks every value exactly as a typed one is checked, so what the browser sends is never trusted.
import type { Driver } from "@/lib/db/types";
import { UserError } from "@/lib/master/service";
import { allowShared } from "@/lib/rate-limit";
import { adviseSettings, aiConfigured, type CreateMessage } from "@/lib/ai/claude";
import { AI_BLOCKED_SETTINGS, MAX_PROPOSALS, type SettingsAdvice } from "@/lib/ai/settings-assist";
import { checkPlatformSetting, loadPlatformSettings, PLATFORM_SETTINGS, savePlatformSetting } from "./settings";

export const SETTINGS_ASKS_PER_HOUR = 30;

/** Is the assistant offered? The server has the AI. (Only operators reach the screen at all.) */
export const settingsAssistantOffered = () => aiConfigured();

export async function askSettingsAssistant(driver: Driver, operatorId: string, request: string, create?: CreateMessage): Promise<SettingsAdvice> {
  if (!aiConfigured()) throw new UserError("The assistant is not switched on for this service. Change the settings by hand.");
  const text = request.replace(/\s+/g, " ").trim();
  if (text.length < 3) throw new UserError("Say what you want to change or know, for example: set the daily WhatsApp limit for everyone else to 25.");
  if (text.length > 1000) throw new UserError("That is too long. Keep the request under 1,000 characters.");
  if (!(await allowShared(driver, `settings-ai:${operatorId}`, SETTINGS_ASKS_PER_HOUR, 3600))) throw new UserError("You have asked the assistant a lot this hour. Try again later, or change the settings by hand.");
  const current = await loadPlatformSettings(driver);
  const r = await adviseSettings(text, PLATFORM_SETTINGS, current, create);
  if (r.status !== "ok") throw new UserError(r.reason);
  return r.advice;
}

export type Change = { key: string; value: string };

/** Applies the changes the operator ticked. Each is checked like a typed value; one that fails stops the rest, so nothing is half done. Returns how many were saved. */
export async function applySettingChanges(driver: Driver, operatorId: string, changes: Change[]): Promise<number> {
  if (!Array.isArray(changes) || changes.length === 0) throw new UserError("Tick at least one change.");
  if (changes.length > MAX_PROPOSALS) throw new UserError(`At most ${MAX_PROPOSALS} changes at a time.`);
  const keys = new Set<string>();
  for (const c of changes) {
    if (typeof c?.key !== "string" || typeof c?.value !== "string") throw new UserError("A change was not understood.");
    if (AI_BLOCKED_SETTINGS.has(c.key)) throw new UserError("That setting is typed by hand, not changed here.");
    if (!PLATFORM_SETTINGS.some((d) => d.key === c.key)) throw new UserError("Unknown setting.");
    if (keys.has(c.key)) throw new UserError("A setting appears twice.");
    keys.add(c.key);
  }
  for (const c of changes) checkPlatformSetting(c.key, c.value);                // every value first, so a bad one saves nothing
  for (const c of changes) await savePlatformSetting(driver, operatorId, c.key, c.value);
  return changes.length;
}
