import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "./pool.js";

/** Any fixed number. It names the lock that stops two migration runs overlapping. */
const MIGRATION_LOCK = 4_815_162_342;

/**
 * Applies every `.sql` file in `directory` that has not been applied yet, in
 * file-name order. Each file runs in its own transaction and is recorded in
 * `schema_migrations`, so running this again does nothing.
 */
export async function migrate(pool: Pool, directory: string): Promise<string[]> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const alreadyApplied = new Set(done.rows.map((row) => row.name));

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = await readFile(path.join(directory, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    client.release();
  }
}
