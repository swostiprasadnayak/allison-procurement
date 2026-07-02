import { Pool } from "pg";

/**
 * Server-only Postgres client for the local CDM.
 *
 * The pool is cached on `globalThis` so Next's dev HMR (which re-evaluates
 * modules) reuses a single pool instead of leaking a new one on every reload.
 */

const CONNECTION_STRING =
  process.env.DATABASE_URL ?? "postgresql://navanta:navanta@localhost:5432/navanta";

const globalForPg = globalThis as unknown as { __navantaPgPool?: Pool };

const pool: Pool =
  globalForPg.__navantaPgPool ??
  new Pool({ connectionString: CONNECTION_STRING });

if (!globalForPg.__navantaPgPool) {
  globalForPg.__navantaPgPool = pool;
}

/** Run a parameterized query and return the rows, typed as `T`. */
export async function q<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query(sql, params as unknown[] | undefined);
  return result.rows as T[];
}
