# ADR-059: HR vehicle requests

Status: accepted, 2026-11-07 (built, not deployed; tenant migration 0034 not run on live). Owner decisions: a new `hr` role asks for a vehicle for an employee; the administrator **and the fleet manager** may decide.

## Decision
1. **A new role `hr`** holds `vreq.request` (ask for a vehicle for an employee) and `vreq.read_all` (see every request). It holds nothing else: no vehicle, job card or cost permissions.
2. **Deciders:** `tenant_admin` and `fleet_manager` hold `vreq.decide`; `auditor` can read. A decider either
   - **gives a vehicle from the pool**: an active vehicle that nobody holds at the moment (no open custody row). The employee becomes its holder through the existing `change_custody`, starting on the date needed or today, whichever is later; or
   - **approves buying one** (`purchase_approved`), and later gives the vehicle once it has been added to the fleet; or
   - **rejects** (reason required).
   The person who asked, or a decider, may **cancel** an open request (reason required).
3. **Statuses:** requested, purchase_approved, assigned, rejected, cancelled. Moves are only through the SQL function `vehicle_request_transition`, which writes `vehicle_request_events` (who, when, note). Nothing else updates `vehicle_requests.status`.
4. **Segregation of duties:** a person cannot decide a request made for themselves (the database refuses it). Another decider must.
5. **One open request per employee** (a partial unique index), so a duplicate is refused.
6. **Notifications:** deciders are told of a new request and of a cancellation; the HR person is told of each decision. HR and deciders can read notifications.
7. No module switch: the screens appear only for a role that holds one of the three permissions.

## Not in this change
- A vehicle bought for the request is added on the Vehicles page as usual; the request is then completed by giving it. There is no purchase order or cost tracking here.
- The Features page and flyer do not mention it yet.

## Owner steps
Run the tenant migration on live (`scripts/migrate-tenants.mts`), then invite an HR person with role HR on the Users page. Nothing runs or shows until then.

## Tests
`tests/vehicle-requests.test.ts` (14): asking, refusals, duplicate, who sees what, giving a pool vehicle and its custody, held and workshop vehicles refused, purchase then give, reasons, HR cancel but not decide, no self-decision, an HR login loading the home page without a permission error.
