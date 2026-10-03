import { defineConfig } from "vitest/config";

// Unit tests: fast, no database.
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
