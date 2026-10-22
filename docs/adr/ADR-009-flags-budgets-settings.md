# ADR-009: Flag rules, budgets, settings and service rules

Status: accepted, Phases 5 and 6.

- **Thresholds live in `settings`; the database applies them.** Migration 0010 adds `setting_num()` and the views `flag_jobs_90d`, `flag_repeat_days`, `flag_cost_multiple` and the combined `v_vehicle_flags` (these three plus budget near/over and document expired/due). Screens only read the views, so the rules cannot differ between a list and a report.
- **Repeat repair** = same vehicle and same reason within `flag_repeat_days` of the previous job (`v_repeat_repairs.is_repeat`). Routine scheduled service never counts. The view keeps its old columns and appends new ones.
- **Cost against peers** compares a vehicle's last-12-month cost with the median for the same make and model, and only when at least 3 such vehicles exist and the median is above zero. With fewer there is nothing fair to compare with, so nothing is flagged.
- **Cost means** the payable invoice amount once finance has verified it, otherwise the estimate lines (existing `v_vehicle_job_cost`). Drafts, cancelled and rejected cards are not counted. Costs are dated by when the job card was raised, not paid.
- **Budgets:** one budget per vehicle or for the whole fleet per period, no overlaps, an amount change needs a new reason (database triggers from 0004). Never deleted. Warning and over-limit levels come from settings, and the warning cannot be above the over-limit level.
- **Settings are changed per key, each with its own permission** (table in `src/lib/control/settings.ts`): service due warnings need `service.manage`; budget and flag levels need `budget.manage`; reminder days and odometer limits need `admin.settings`. A form that mixes keys is refused as a whole if any changed key is not allowed, and unchanged keys need no permission. The database still accepts only known keys with valid values.
- **Service rules:** the key is made from the name once and never changes (job card lines refer to it). A rule needs a time interval, a distance interval, or both; it can be limited to vehicle classes; "not in use" drops it from due lists.
- **Reports** (`report.view`): costs by month, reason, vehicle, workshop and driver-at-the-time, and "Why it keeps breaking": repeat repairs with the workshop that did the earlier job, workshops whose work came back, reasons, busiest vehicles, and where managers changed the reason a requester gave.
- **Not built:** CSV export of these reports (Phase 8), cost per kilometre (needs reliable odometer history first), per-vendor quality scores beyond "work that came back".
