import pg from "pg";

export type Pool = pg.Pool;

/** Anything a query can run on: the pool itself, or one connection inside a transaction. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString });
}

/**
 * Runs `work` inside one transaction. Everything it does is saved together,
 * or, if it throws, nothing is.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const UNIQUE_VIOLATION = "23505";

/** True when a query failed because it broke the named unique constraint or index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof pg.DatabaseError &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint === constraint
  );
}
