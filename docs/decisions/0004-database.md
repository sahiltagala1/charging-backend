# 4. PostgreSQL, plain SQL and where each rule is enforced

## Decision

Data lives in PostgreSQL. The schema is written as plain SQL files in `migrations/`, queries are plain SQL through the `pg` driver, and a small runner (`src/db/migrate.ts`) applies migrations in order.

The code is split into three layers:

| Layer     | Folder          | Job                                                         |
| --------- | --------------- | ----------------------------------------------------------- |
| Rules     | `src/domain/`   | Decides what is allowed. Knows nothing about the database.  |
| Storage   | `src/db/`       | Turns rows into domain values and back. Makes no decisions. |
| Use cases | `src/services/` | Loads, asks the rules, saves, all in one transaction.       |

## Why PostgreSQL

Sessions, events and readings are related records that must stay consistent with each other, and they end up as bills. A relational database gives transactions, foreign keys and constraints for exactly that.

## Rules the database enforces

Some rules cannot be left to application code, because two requests can arrive at the same moment and both pass a check before either saves.

- **One open session per charger.** A partial unique index, `one_open_session_per_charger`, covers only sessions that are still open. If two requests race, the database lets one in and the service reports `CHARGER_BUSY` for the other.
- **An event is stored once.** The primary key of `session_events` is `(session_id, event_id)`.
- **A reading is stored once.** The primary key of `meter_readings` is `(session_id, reading_id)`.
- **Meters do not go negative or backwards.** `CHECK` constraints repeat the domain rules as a last line of defence.

## One request at a time per session

Applying an event or a reading locks the session row with `SELECT ... FOR UPDATE` until the transaction ends. A second request for the same session waits, then sees the result of the first. This is what makes six copies of the same message, arriving together, end up as one stored event. There is a test for exactly that.

## Alternatives considered

- **An ORM such as Prisma or Drizzle.** Less SQL to write, but the partial index, row locks and constraints here are easier to read and reason about as SQL.
- **A migration library.** The runner is about forty lines, and each step is visible: take a lock, skip files already applied, run each new file in a transaction.
- **MongoDB.** Familiar from earlier work, but multi-record consistency is the central problem in this project.

## Consequences

- Integration tests need a real PostgreSQL. Locally that is `npm run db:up`; in CI it is a service container.
- `bigint` columns come back from the driver as strings, so the storage layer converts them to numbers. Meter values stay far below the limit where that loses precision.
