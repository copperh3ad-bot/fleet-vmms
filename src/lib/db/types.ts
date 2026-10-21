// The only shape the rest of the app knows about a database. Real code uses pg; tests use PGlite.
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Driver {
  /** Runs fn inside one transaction. Rolls back if fn throws. */
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}
