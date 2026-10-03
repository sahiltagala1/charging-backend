import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

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
  it("uses safe defaults", () => {
    expect(loadConfig({})).toEqual({ PORT: 3000, HOST: "127.0.0.1", LOG_LEVEL: "info" });
  });

  it("rejects a bad port with a readable message", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid configuration.*PORT/);
  });
});
