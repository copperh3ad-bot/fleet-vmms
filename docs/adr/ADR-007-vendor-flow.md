# ADR-007: Vendor flow (quotation, work order, invoice)

Status: accepted, Phase 4.

- **One SQL function per step** (migration 0007): `submit_quotation`, `approve_quotation`, `reject_quotation`, `vendor_start_work`, `vendor_complete_work`, `submit_invoice`; the finance decision is the existing `verify_invoice`. Each saves its rows and moves the job card through `transition_job_card`, so the guard and the event row apply.
- **A vendor's login is tied to one active vendor** (`vendors.user_id`, unique). Every vendor function checks that the job or work order belongs to that vendor and answers "not found" otherwise, so another vendor cannot tell it exists.
- **Vendors read only `v_vendor_*` views**: work orders (the view named in the plan), plus job requests, own quotation lines and own invoices. They filter on `app.user_id`, carry no requester, approver, custodian or budget columns (a test checks the column names), and the vendor role holds no `jobcard.*` permission so the job card screens refuse it.
- **Rejecting a quotation** returns the job to "vendor assigned" with the same vendor (`transition_job_card` redefined in 0007 for this) and the vendor can send a new quotation. Changing to a different vendor after a quotation exists is not built.
- **Segregation:** the requester cannot approve the quotation; the approver or requester cannot verify the invoice (existing). The vendor cannot approve anything.
- **Work order amount = approved quotation total.** Invoice total = sum of its lines. Lines that point to a quotation line are "approved"; lines without a pointer are shown to finance as not in the quotation. Tax is separate and not part of the variance.
- **Invoice decision:** pay the approved amount, pay in full (note required), or return (note required; the job goes back to "work done" and the vendor can send a corrected invoice; only one open invoice per work order).
- **Close** (`invoice_verified` -> `closed`) needs `invoice.verify` and is a plain transition.
- **Notifications** for each hand-over (assigned, quotation received, approved/rejected, work done, invoice submitted, verified/returned), written in the same transaction.
- **Not built yet:** attachments on quotations and invoices (quotation PDF), payment recording (`paid`), vendor invitations (a vendor login is created by hand in Supabase Auth plus a membership row until the Users screen exists).
