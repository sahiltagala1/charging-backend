# 2. Session rules as pure functions

## Decision

The rules of a charging session live in `src/domain/session.ts` as plain functions. `applyEvent(session, event)` returns either the next session or a reason the event was refused. It does not touch a database, read the clock, change its inputs or throw.

```
requested ──authorized──▶ authorized ──started──▶ charging ──stopped──▶ completed
    │                          │                      │
    └──rejected──▶ rejected    └──────faulted─────────┴──▶ faulted
```

## Why

- **The rules are the part most worth getting right.** A session that skips a step, ends twice or runs its meter backwards becomes a wrong bill. Keeping the rules free of infrastructure means every case can be tested in milliseconds.
- **One table of transitions.** The allowed moves are data (`TRANSITIONS`), so they can be read at a glance and a missing rule is easy to spot.
- **Refusals are return values.** A charger sending an event out of turn is expected, so it is reported as a result the caller must handle. Exceptions are kept for real bugs.
- **Duplicates are harmless.** Chargers resend messages when they get no reply. Each event has an id, and applying an id twice returns the same session.
- **Energy in whole watt-hours.** Integers avoid rounding errors that fractional kilowatt-hours would bring into billing.

## Alternatives considered

- **A state-machine library such as XState.** Useful for large machines; this one has six states and fits in a small table.
- **Rules inside the route handlers.** Quicker to write, but they could then only be tested through HTTP and a database.

## Not covered yet

- Meter readings during a session, including ones that arrive late or out of order.
- Storing the list of applied event ids in a database, where it becomes a unique constraint.
