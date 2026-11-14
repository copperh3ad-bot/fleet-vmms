// What the administrator may tick for a role (ADR-097). Every permission the database knows is either here, with a plain sentence and a group, or in LOCKED with the
// reason it cannot be handed out. tests/custom-roles.test.ts fails when the database has a permission that is in neither list, so a new one is decided on purpose.

export type CatalogItem = { key: string; label: string };
export type CatalogGroup = { title: string; items: CatalogItem[] };

export const PERMISSION_GROUPS: CatalogGroup[] = [
  { title: "Vehicles", items: [
    { key: "vehicle.read", label: "See vehicles" },
    { key: "vehicle.write", label: "Add and edit vehicles" },
    { key: "odometer.submit", label: "Send an odometer reading" },
    { key: "odometer.review", label: "Review odometer readings" },
  ] },
  { title: "Job cards and workshops", items: [
    { key: "jobcard.create", label: "Raise a job card" },
    { key: "jobcard.read_own", label: "See the job cards they raised" },
    { key: "jobcard.read_all", label: "See every job card" },
    { key: "jobcard.approve", label: "Approve a job card" },
    { key: "jobcard.assign_vendor", label: "Choose the workshop" },
    { key: "quotation.approve", label: "Approve a quotation" },
    { key: "vendor.manage", label: "Add and edit workshops" },
    { key: "vendor.rate", label: "Rate and flag workshops" },
  ] },
  { title: "Invoices and money", items: [
    { key: "invoice.read", label: "See invoices and payments" },
    { key: "invoice.verify", label: "Verify an invoice" },
    { key: "invoice.pay", label: "Record a payment" },
    { key: "invoice.approve_payment", label: "Approve a payment over the limit" },
    { key: "budget.manage", label: "Edit budgets" },
    { key: "report.view", label: "See every cost and report" },
  ] },
  { title: "Papers and rules", items: [
    { key: "compliance.manage", label: "Record documents, accidents and challans" },
    { key: "service.manage", label: "Edit service rules" },
    { key: "policy.read", label: "Read the maintenance policy" },
    { key: "policy.manage", label: "Edit the maintenance policy" },
  ] },
  { title: "Trips, vehicle requests and cargo", items: [
    { key: "trip.request", label: "Ask for a trip" },
    { key: "trip.approve", label: "Approve a trip" },
    { key: "trip.dispatch", label: "Dispatch a trip" },
    { key: "trip.award", label: "Ask providers to quote and award a trip" },
    { key: "trip.read_all", label: "See every trip" },
    { key: "vreq.request", label: "Ask for a vehicle" },
    { key: "vreq.decide", label: "Decide a vehicle request" },
    { key: "vreq.assign", label: "Give a pool vehicle for a request" },
    { key: "vreq.confirm_budget", label: "Confirm the budget for buying a vehicle" },
    { key: "vreq.read_all", label: "See every vehicle request" },
    { key: "vreq.see_pool", label: "See the vehicles nobody holds" },
    { key: "cargo.request", label: "Ask for cargo pick-up and delivery" },
    { key: "cargo.handle", label: "Accept, follow and deliver cargo requests" },
    { key: "cargo.read_all", label: "See every cargo request" },
  ] },
  { title: "Company", items: [
    { key: "employee.manage", label: "Edit the employee list" },
    { key: "depot.manage", label: "Edit depots and places" },
    { key: "activity.read", label: "Read the activity log" },
    { key: "admin.settings", label: "Change company settings" },
  ] },
];

/** Never handed out or taken away from the screen, and why. */
export const LOCKED: Record<string, string> = {
  "admin.users": "Managing people and roles stays with the administrator role, so an organization can never be left with nobody who can edit them.",
  "quotation.submit": "Belongs to the workshop role: an outside party quotes through its own portal.",
  "workorder.update": "Belongs to the workshop role: an outside party updates its own work orders.",
  "invoice.submit": "Belongs to the workshop role: an outside party sends its own invoices.",
  "gate.use": "The gate security role has no screen yet (ADR roles-not-ready).",
};

export const EDITABLE = new Set(PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key)));

/** One role may not both approve spending and verify the invoice for it. The administrator is the one exception, by ADR-077, with the rules on deciding one's own items. */
export const APPROVES = ["jobcard.approve", "quotation.approve"];
export const VERIFIES = ["invoice.verify"];
