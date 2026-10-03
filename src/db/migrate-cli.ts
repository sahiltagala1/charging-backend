import { loadConfig } from "../config.js";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

// Run with `npm run db:migrate`.
const pool = createPool(loadConfig().DATABASE_URL);
try {
  const applied = await migrate(pool, "migrations");
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await pool.end();
}
