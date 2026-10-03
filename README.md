# Charging backend

The server behind a small EV charging network. Chargers connect to it, drivers start and stop sessions, and it works out what each session cost.

There are no real chargers here. A simulator in this repo will stand in for a fleet of them.

This is a personal project by Mohammed Sahil Tagala. It is written from scratch and contains no code or data from any employer.

## Status

| Stage | What it adds | State |
| --- | --- | --- |
| 1. Core | Project skeleton, session rules, charger simulator, REST API, database | In progress |
| 2. Complete | Pricing, late and duplicate messages, live dashboard, public deployment | Planned |
| 3. Roaming | Two networks exchanging sessions over an OCPI-style API | Stretch |

What exists today: the project skeleton with a health check, configuration checking, tests and CI.

## Run it

Needs Node.js 22 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

Then open http://127.0.0.1:3000/health.

## Check it

```bash
npm run check    # lint, type check and tests
npm run build    # compile to dist/
```

The same checks run on GitHub for every push and pull request.

## Layout

| Path | What it holds |
| --- | --- |
| `src/app.ts` | Builds the HTTP app. Tests use this directly. |
| `src/server.ts` | Starts the app and handles shutdown. |
| `src/config.ts` | Reads and checks environment variables. |
| `test/` | Tests. |
| `docs/decisions/` | One short note per significant decision, with the reasons and the alternatives. |

## How decisions are recorded

Each significant choice gets a short note in `docs/decisions/`. A note says what was decided, why, and what else was considered.
