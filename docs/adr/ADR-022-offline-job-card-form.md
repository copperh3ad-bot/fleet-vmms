# ADR-022: Offline job card form

Status: accepted, 2026-10-24. Owner request: a standardized job card form that people can export, fill in offline, and upload.

## Decision
1. **A one-page Excel workbook (`.xlsx`).** Opens in Excel, Google Sheets and the Excel phone app, prints on one A4 page, and carries drop-down lists so what comes back matches what the system knows. One form is one job card (a person copies the file for each job).
2. **Download (`/w/<slug>/job-cards/form`, signed-in, needs `jobcard.create`).** The lists in the file hold only the vehicles that member may raise a card for (a requester with "own" scope gets their own vehicle) and the active reasons. Nothing about other companies is in it. Not cached.
3. **Upload (`/w/<slug>/job-cards/import`, signed-in, needs `jobcard.create`).** Up to 10 files at a time. Each valid file becomes one **draft** job card through `createJobCard`, the same function the on-screen form uses, so the permission, the vehicle scope, the odometer rule and the database rules all apply unchanged. A file is never submitted for approval: the person opens the draft, may add photos, and submits it. A refused file creates nothing and says what is wrong, by the name on the form.
4. **Reading is strict.** A fixed form marker (`FLEETOTG-JOBCARD-v1`) and fixed cell positions; the sheet is locked (no password) so the layout is not changed by accident, and a changed layout is refused. Values are mapped only through the lists this member was given, so a typed plate or reason that is not in them is refused. Files over 1 MB are refused before they are read; the zip's own directory is checked first and a file claiming to unpack beyond 10 MB, or with over 100 parts, is refused before anything is unpacked. Only the named sheet's known cells are read; formulas and macros are not run, and the workbook format cannot carry macros.
5. **Library.** `exceljs`, with its `uuid` dependency overridden to a patched version in `package.json` so `npm audit --omit=dev` stays at zero findings.

## Not done
- **No de-duplication.** Uploading the same file twice makes two drafts. They are drafts, the person can cancel one, and a safe key would need a new column in every company's schema. Revisit if it happens in practice.
- **Several cards in one file**, **photos inside the file**, and **an Urdu form** are not built. Photos are added to the draft on screen.
- **Vehicle and reason lists are as of the download.** A vehicle added later is refused by an old form with a plain message; the page tells people to download a fresh form now and then.
