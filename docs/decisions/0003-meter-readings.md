# 3. Meter readings that arrive late, twice or out of order

## Decision

A session's meter readings are kept in a log sorted by the time each reading was taken, not the time it arrived. `addReading(log, reading, bounds)` in `src/domain/meter.ts` puts each reading in its place, ignores one it has seen before, and refuses one that cannot be true.

A reading is refused when:

- charging has not started yet;
- its meter value is not a whole number of watt-hours, zero or more;
- it is dated before the session started or after it ended;
- it does not fit between the readings around it, because an energy meter only counts upwards.

## Why

- **Chargers go offline.** A charger that loses its connection keeps charging and sends its stored readings when it reconnects. Those readings are late, and they are still true.
- **Order of arrival must not matter.** The same set of readings always produces the same log. That makes the outcome predictable and easy to test: the tests feed the same readings in four different orders and expect one result.
- **Late is fine, impossible is not.** Accepting a late reading keeps real data. Refusing a reading that runs the meter backwards keeps bad data out of bills and out of the anomaly model.
- **Readings are separate from the session.** The session records how charging started and ended. The readings describe what happened in between. Keeping them apart keeps both modules small.

## Alternatives considered

- **Reject anything that arrives out of order.** Simple, but it throws away true data every time a charger reconnects.
- **Accept everything and clean up later.** Bad readings would already be in the database, and every reader of the data would need its own clean-up.

## Not covered yet

- Storing the log. In the database, the reading id becomes a unique key per session.
- A late reading that conflicts with a bill already issued. That belongs with pricing.
