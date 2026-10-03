import { defineConfig } from "vitest/config";

// Integration tests talk to a real PostgreSQL database. They share one
// database, so the files run one at a time.
export default defineConfig({
  test: { include: ["test/integration/**/*.test.ts"], fileParallelism: false },
});
