# ADR-038: The vehicle sheet before sign-up, and a vehicle limit during the free trial

Status: accepted, 2026-10-28.

## Decision
1. **A blank vehicle sheet can be downloaded before signing up.** The sign-up page and the check-your-email page offer it: `GET /vehicle-sheet.xlsx` (Excel) and `/vehicle-sheet.csv`. The aim is that a trial
   is spent trying the product, not typing a fleet in: a company fills in its number plates while it waits, then uploads the file once its workspace is ready. Only `registration_no` is needed; the rest is optional.
2. **It is the same file for everyone and holds no customer data**, so these two addresses are open (CLAUDE.md rule 5). It is built from the import's own column list (`VEHICLE_CSV_COLUMNS`), so the sheet and
   the import cannot drift apart (a test reads the file back). The Excel file has notes on each column, drop-down lists for vehicle class and fuel type, date formatting, an Example sheet (not uploaded) and a Read me
   sheet; it states the trial's vehicle limit.
3. **The import reads the filled-in Excel file directly** (`xlsxToCsv`), so there is no "save as CSV" step; CSV still works. Only cell values are read: no macro, link or formula is run or followed. 2 MB and 500 rows.
4. **A free trial allows a small fleet: 10 vehicles** (the owner's setting `trial_max_vehicles`, 10 when empty, in Admin, Settings). It is enforced on the server for adding one vehicle and for importing (an import that
   would go over is refused whole, with a message saying how many fit; the preview shows the same note), so the sheet cannot be used to get round it. It applies only while the trial runs (`access.state === "trial"`);
   once the organization subscribes, or is comped, only its plan's own limits apply. Vehicles marked disposed do not count. The plan-usage figure shows the lower of the trial cap and the plan limit.
5. The trial limit is the owner's number, not a price, but it is a limit on what a customer gets, so it lives in a setting and not in code (rule 7's spirit).

## Not done
- No limit on employees or job cards during a trial, only vehicles.
- The Excel sheet is not localised.
