import { Pool } from "pg";
import type { Driver, Queryable } from "./types";

/** Production driver. Works with a pooler in transaction mode because every use is one explicit transaction. */
export function pgDriver(connectionString: string): Driver & { end(): Promise<void> } {
  const pool = new Pool({ connectionString, max: 10 });
  return {
    async transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
