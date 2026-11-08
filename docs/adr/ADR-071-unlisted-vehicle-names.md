# ADR-071: Unlisted makes and models, with operator review

Status: built, not yet live (control migration 0022 and a deploy). Owner request: fleet owners must be able to add vehicles that are not on any list, with admin moderation. Pakistan has grey imports, rebuilt vehicles, local modifications and older models that no catalogue will fully cover.

## Context

ADR-052 gave the Add vehicle form make, model and year drop-downs with "Other (type it)", so a vehicle was never refused. But a typed name went nowhere: it was never reviewed, never offered to the next owner of the same vehicle, and the same make came out in several spellings ("Toyota", "TOYOTA", "Toyta") in a company's reports.

## Decision

- **Never block.** The owner types the make and model, the vehicle is saved at once with the name as typed (tidied to the settled spelling if it matches one). Review never holds a vehicle up.
- **Record once.** After the vehicle is saved, each name the built-in list lacks is recorded in `public.vehicle_name_suggestions` (control migration 0022): one row per make, and one per make and model, however many vehicles and companies use it. `uses` counts vehicles; `vehicle_name_uses` counts companies. Names match with case, spaces and punctuation ignored ("Land Cruiser" = "land-cruiser"). The spreadsheet import records names the same way.
- **Own list first.** The company that typed a name sees it in its own drop-downs straight away, so the next vehicle of that kind is a pick, not a retype. No one else sees it while it is pending.
- **Operator decides** on Admin, Vehicle names, one of three ways:
  - **Approve:** the name joins every company's drop-downs. The operator may fix spelling or capitals, not change the name; approving a model brings its make with it.
  - **Merge:** it is a spelling variant of a name already on the list. Later vehicles typed this way are saved with the listed name. Vehicles already saved keep what their owners typed (no rewrite across companies).
  - **Reject:** a mistake or nonsense. It is not offered to anyone, a reason is kept, and it is not counted again.
  Every decision is on the platform audit trail and the activity log (ADR-070).
- **Guard rails.** A name is kept only if it is 1 to 40 (make) or 60 (model) characters of letters, numbers and plain punctuation, and does not look like a web address or email. One company can add 40 new names to the queue a day; names already queued still count. Everything is read-only for the Supabase API roles (row security, no grants).
- **Older models.** The year list now goes back to 1950, the form's own limit (it stopped at 1980).
- **Fails soft.** If the new tables are missing or unreadable, the drop-downs show the built-in list and vehicles are saved as typed.

## Not built

- Rewriting vehicles already saved when a name is merged (each company's records are its own; the settled spelling applies from the next vehicle on).
- A flag for grey import, rebuilt or modified vehicles on the vehicle record. Say so if the reports need it.
- Per-make validation of chassis and engine numbers: they stay free text up to 40 characters, because imported vehicles do not follow one format.

## Order of going live

Apply control migration 0022, then deploy. Until it is applied, the form works as before.
