import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";

const app = buildApp({ LOG_LEVEL: "silent" });
afterAll(() => app.close());

describe("GET /health", () => {
  it("reports that the service is up", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("answers unknown routes with 404", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("configuration", () => {
  const DATABASE_URL = "postgres://user:pass@localhost:5432/db";

  it("uses safe defaults", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      PORT: 3000,
      HOST: "127.0.0.1",
      LOG_LEVEL: "info",
      DATABASE_URL,
    });
  });

  it("rejects a bad port with a readable message", () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: "abc" })).toThrow(/Invalid configuration.*PORT/);
  });

  it("refuses to start without a database address", () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration.*DATABASE_URL/);
  });
});
