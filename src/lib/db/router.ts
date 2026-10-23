// Sends each transaction to the right database (ADR-014). Work with no schema goes to the control database. Work for an
// organization goes to its own database if it has one (db_kind = 'dedicated'), otherwise to the control database, where
// the older shared organizations still live. Pools are small, reused, and bounded in number.
import type { Driver, Queryable, Route } from "./types";

type Ender = { end?(): Promise<void> };
export type RouterOptions = {
  control: Driver & Ender;
  /** Opens a driver (a small pool) for a connection string. */
  makeDriver: (url: string) => Driver & Ender;
  /** Turns the stored, encrypted connection string back into a usable one. */
  decrypt: (boxed: string) => string;
  /** How long a lookup of "where does this organization live" is reused, in ms. */
  ttlMs?: number;
  /** The most organization pools kept open at once; the least recently used is closed first. */
  maxPools?: number;
  now?: () => number;
};
export type RoutingDriver = Driver & { end(): Promise<void>; forget(schema: string): void };

type Where = { kind: "control" } | { kind: "dedicated"; url: string };
type Row = { db_kind: string; db_url_enc: string | null; provision_state: string };

export function routingDriver(o: RouterOptions): RoutingDriver {
  const ttl = o.ttlMs ?? 60_000, maxPools = o.maxPools ?? 20, now = o.now ?? Date.now;
  const where = new Map<string, { at: number; w: Where }>();
  const pools = new Map<string, { driver: Driver & Ender; url: string; used: number }>();

  async function locate(schema: string): Promise<Where> {
    const hit = where.get(schema);
    if (hit && now() - hit.at < ttl) return hit.w;
    const row = (await o.control.transaction(async (q: Queryable) => {
      await q.query("set local search_path = public");
      return (await q.query<Row>("select db_kind, db_url_enc, provision_state from public.tenants where schema_name = $1", [schema])).rows[0];
    }));
    let w: Where = { kind: "control" };
    if (row?.db_kind === "dedicated") {
      if (row.provision_state !== "ready" || !row.db_url_enc) throw new Error("This organization is still being set up.");
      w = { kind: "dedicated", url: o.decrypt(row.db_url_enc) };
    }
    where.set(schema, { at: now(), w });
    return w;
  }

  function poolFor(schema: string, url: string): Driver {
    const have = pools.get(schema);
    if (have && have.url === url) { have.used = now(); return have.driver; }
    if (have) { void have.driver.end?.().catch(() => undefined); pools.delete(schema); }   // the connection string changed
    while (pools.size >= maxPools) {
      const oldest = [...pools].sort((a, b) => a[1].used - b[1].used)[0];
      void oldest[1].driver.end?.().catch(() => undefined);
      pools.delete(oldest[0]);
    }
    const driver = o.makeDriver(url);
    pools.set(schema, { driver, url, used: now() });
    return driver;
  }

  return {
    async transaction<T>(fn: (q: Queryable) => Promise<T>, route?: Route): Promise<T> {
      if (!route?.schema) return o.control.transaction(fn);
      const w = await locate(route.schema);
      return w.kind === "control" ? o.control.transaction(fn) : poolFor(route.schema, w.url).transaction(fn);
    },
    forget(schema) { where.delete(schema); },
    async end() {
      await Promise.all([...pools.values()].map((p) => p.driver.end?.().catch(() => undefined)));
      pools.clear();
      await o.control.end?.();
    },
  };
}
