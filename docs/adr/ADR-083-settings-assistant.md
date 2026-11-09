# ADR-083: An AI assistant on the operator's Settings screen (proposes, never saves)

Status: accepted, 2026-11-09 (owner request: "Add AI assistant for better and easier admin settings").

## Decision
- The operator's Settings screen (Admin, platform operators only) has an **Ask the assistant** box. The operator writes in plain words ("set the daily WhatsApp limit for everyone else to 25", "turn the WhatsApp codes off for testing", "what does the rate side do?"). The assistant answers and **proposes** changes, each shown as `current -> new` with a one-line reason and any warning. The operator ticks the ones they want and presses Apply.
- **The AI changes nothing.** `askSettingsAssistant` returns proposals and stores nothing. `applySettingChanges` is the only path from a proposal to a change, runs as the operator, and checks every value exactly as a typed one is checked (`checkPlatformSetting`); one bad value saves none. At most 8 changes at a time; unknown keys, repeats and empty lists are refused. Every action is on the activity record (ADR-070).
- **What the model sees:** the operator's request (up to 1,000 characters) and, for each setting, its key, label, explanation, allowed values and kind. A short setting (a number, a percent, a choice) shows its current value; long text (addresses, seller details, registration numbers) shows only "set" or "not set". **The bank details are never shown to the AI and can never be proposed or applied through it**; they are typed by hand.
- **Checking:** a proposal is kept only if the setting exists, is not blocked, and the value passes the setting's own check; a value equal to the current one is dropped; what is dropped is explained in a warning, not silently lost. The prompt treats the settings and the request as data, never instructions.
- **Limits and cost:** 30 questions an hour per operator; one small call to the cheapest model (Haiku 5.5, a few hundred tokens each, a fraction of a cent). The box appears only where the server has the AI key (the same switch as the other AI features).
- The screen itself became sections that fold, a search box, one compact row per setting with Save that wakes only when the value changed, and a banner while testing mode is on. When the assistant applies a change, the rows update at once.

## Not done
- The assistant is for the platform operator's Settings only. A company administrator's own settings (budgets, service rules) are not covered.
- No history of what the assistant proposed is stored; what was applied is in the activity log and each setting's `updated_by`/`updated_at`.
