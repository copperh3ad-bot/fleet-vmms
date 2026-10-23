// The only shape the rest of the app knows about a database. Real code uses pg; tests use PGlite.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Which organization's database a transaction belongs to. No schema means the control database. */
export type Route = { schema?: string };

export interface Driver {
  /** Runs fn inside one transaction. Rolls back if fn throws. The route is read by the routing driver and ignored by single-database drivers. */
  transaction<T>(fn: (q: Queryable) => Promise<T>, route?: Route): Promise<T>;
}
