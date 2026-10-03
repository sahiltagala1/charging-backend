# Charging backend

The server behind a small EV charging network. Chargers connect to it, drivers start and stop sessions, and it works out what each session cost.

There are no real chargers here. A simulator in this repo will stand in for a fleet of them.

This is a personal project by Mohammed Sahil Tagala. It is written from scratch and contains no code or data from any employer.

## Status

| Stage       | What it adds                                                            | State       |
| ----------- | ----------------------------------------------------------------------- | ----------- |
| 1. Core     | Project skeleton, session rules, charger simulator, REST API, database  | In progress |
| 2. Complete | Pricing, late and duplicate messages, live dashboard, public deployment | Planned     |
| 3. Roaming  | Two networks exchanging sessions over an OCPI-style API                 | Stretch     |

What exists today: the project skeleton (health check, configuration checking, tests, CI) the rules of a charging session, meter readings that may arrive late, twice or out of order, and a PostgreSQL database that stores them safely when requests arrive at the same moment.

## Run it

Needs Node.js 22.9 or newer and Docker.

```bash
npm install
cp .env.example .env
npm run db:up        # start PostgreSQL in Docker
npm run db:migrate   # create the tables
npm run dev
```

Then open http://127.0.0.1:3000/health. Stop the database with `npm run db:down`.

## Check it

```bash
npm run check              # formatting, lint, type check and unit tests
npm run test:integration   # tests against the real database (needs `npm run db:up`)
npm run build              # compile to dist/
npm run format             # tidy every file with Prettier
```

The same checks run on GitHub for every push and pull request.

## Layout

| Path                    | What it holds                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `src/app.ts`            | Builds the HTTP app. Tests use this directly.                                                     |
| `src/server.ts`         | Starts the app and handles shutdown.                                                              |
| `src/config.ts`         | Reads and checks environment variables.                                                           |
| `src/domain/session.ts` | The rules of a charging session: which events are allowed in which state. No database or network. |
| `src/domain/meter.ts`   | Meter readings during a session, kept in time order whatever order they arrive in.                |
| `test/`                 | Tests.                                                                                            |
| `docs/decisions/`       | One short note per significant decision, with the reasons and the alternatives.                   |

## Code style

- Prettier formats every file, and CI fails if a file is not formatted. In VS Code, install the recommended extensions and files are tidied on save.
- ESLint catches likely mistakes.
- TypeScript runs in strict mode.
- Business rules live in `src/domain/` as plain functions, with no database or network code.
- Comments explain why something is done. The code and the test names say what it does.

## How decisions are recorded

Each significant choice gets a short note in `docs/decisions/`. A note says what was decided, why, and what else was considered.
