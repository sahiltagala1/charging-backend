import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";

/**
 * Builds the HTTP app without starting it. Tests call this and send requests
 * straight into the app, so they need no network port.
 */
export function buildApp(config: Pick<Config, "LOG_LEVEL">): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.get("/health", async () => ({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }));

  return app;
}
