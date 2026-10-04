import { migrate } from "../../src/db/migrate.js";
import { createPool, type Pool } from "../../src/db/pool.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://charging:charging@127.0.0.1:54329/charging_test";

/** Connects to the test database and brings its schema up to date. */
export async function openTestDatabase(): Promise<Pool> {
  const pool = createPool(TEST_DATABASE_URL);
  await migrate(pool, "migrations");
  return pool;
}

/** Empties every table so each test starts from nothing. */
export async function clearTestDatabase(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE chargers, sessions, session_events, meter_readings CASCADE");
}
