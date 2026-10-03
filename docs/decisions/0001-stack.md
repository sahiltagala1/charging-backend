# 1. Language, framework and test tools

## Decision

TypeScript on Node.js 22, Fastify for HTTP, Zod for validation, Vitest for tests.

## Why

- **TypeScript, strict mode.** Charging sessions move through fixed states and carry money. Types catch a whole class of mistakes before the code runs.
- **Fastify.** It validates and logs every request out of the box, and `app.inject()` lets tests call routes without opening a port.
- **Zod.** One schema both checks incoming data at run time and gives the TypeScript type, so the two cannot drift apart.
- **Vitest.** Runs TypeScript directly and starts fast, which keeps the test loop short.

## Alternatives considered

- **Express.** More familiar, but validation, logging and typed routes would all be add-ons.
- **NestJS.** A lot of structure for a project this size.

## Consequences

Node 22 or newer is required. The code uses ES modules, so local imports end in `.js`.
