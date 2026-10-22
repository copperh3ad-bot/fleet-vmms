# ADR-010: Role-aware dashboard and CSV exports

Status: accepted, Phase 8.

- **The home page is built from permissions, not from role names.** `getDashboard` reads one block per permission the member holds (approvals, quotations, vendor assignment, invoices, odometer review, own drafts, documents, fleet numbers) in a single transaction. A new role gets the right dashboard the moment it is given permissions. A role with none of them (a workshop) gets "forbidden" and the page sends workshops to their own list.
- **"Waiting for you" excludes what you raised yourself**, because you could not decide it anyway (segregation of duties).
- **"Your vehicles"** is shown to anyone who currently holds a vehicle and can read vehicles, whatever their role, with service status and document warnings.
- **Exports are a GET route** (`/w/<slug>/export/<kind>`), signed-in members only. It is an authenticated endpoint, so it is not an exception to rule 5. `exportCsv` names the permission each kind needs and checks it before reading any data.
- **Exports match the screens:** the same visibility ("own" scope for vehicles and job cards) and the filters the screen had. Unknown kinds are refused (including names like `constructor`).
- **Spreadsheet formula injection is closed at the writer:** a text cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading apostrophe. Numbers we produce are written as numbers. Files start with a byte order mark so Excel reads names correctly.
- **Cap of 50,000 rows**; larger results are refused with a message to filter.
- **Every successful export is written to the audit log** (who, which export, how many rows, filters, filters cut to 80 characters). A refused export writes nothing.
- **Not built:** scheduled or emailed exports, Excel (.xlsx) format, exports of attachments, a per-export download history screen (the audit log has the data).
