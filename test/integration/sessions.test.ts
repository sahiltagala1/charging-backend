import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import type { Pool } from "../../src/db/pool.js";
import { findSession, insertCharger, loadReadings } from "../../src/db/sessionStore.js";
import type { SessionEvent } from "../../src/domain/session.js";
import { recordEvent, recordReading, startSession } from "../../src/services/sessions.js";
import { clearTestDatabase, openTestDatabase } from "./database.js";

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));
const request = { chargerId: "c1", driverTag: "TAG-1", requestedAt: t(0) };

const authorized: SessionEvent = { type: "authorized", eventId: "e1", at: t(0) };
const started: SessionEvent = { type: "started", eventId: "e2", at: t(0), meterWh: 1000 };
const stopped: SessionEvent = {
  type: "stopped",
  eventId: "e3",
  at: t(60),
  meterWh: 8200,
  reason: "driver",
};

let pool: Pool;

beforeAll(async () => {
  pool = await openTestDatabase();
});
beforeEach(async () => {
  await clearTestDatabase(pool);
  await insertCharger(pool, { id: "c1", name: "Car park, bay 1" });
});
afterAll(() => pool.end());

/** Starts a session and applies the given events, failing the test if anything is refused. */
async function sessionAfter(...events: SessionEvent[]): Promise<string> {
  const result = await startSession(pool, request);
  if (!result.ok) throw new Error(result.message);
  for (const event of events) {
    const applied = await recordEvent(pool, result.session.id, event);
    if (!applied.ok) throw new Error(applied.message);
  }
  return result.session.id;
}

describe("migrations", () => {
  it("do nothing when run a second time", async () => {
    expect(await migrate(pool, "migrations")).toEqual([]);
  });
});

describe("starting a session", () => {
  it("stores a new session in the requested state", async () => {
    const id = await sessionAfter();
    expect(await findSession(pool, id)).toMatchObject({
      state: "requested",
      chargerId: "c1",
      driverTag: "TAG-1",
      requestedAt: t(0),
      appliedEventIds: [],
    });
  });

  it("refuses an unknown charger", async () => {
    const result = await startSession(pool, { ...request, chargerId: "missing" });
    expect(result).toMatchObject({ ok: false, code: "CHARGER_NOT_FOUND" });
  });

  it("refuses a second session while one is open", async () => {
    await sessionAfter(authorized);
    expect(await startSession(pool, request)).toMatchObject({ ok: false, code: "CHARGER_BUSY" });
  });

  it("allows a new session once the previous one has finished", async () => {
    await sessionAfter(authorized, started, stopped);
    expect(await startSession(pool, { ...request, requestedAt: t(90) })).toMatchObject({
      ok: true,
    });
  });

  it("lets exactly one of several simultaneous requests win", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => startSession(pool, request)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.code === "CHARGER_BUSY")).toHaveLength(
      7,
    );
  });
});

describe("applying events", () => {
  it("saves each step of a normal session", async () => {
    const id = await sessionAfter(authorized, started, stopped);
    expect(await findSession(pool, id)).toMatchObject({
      state: "completed",
      startedAt: t(0),
      endedAt: t(60),
      meterStartWh: 1000,
      meterStopWh: 8200,
      endReason: "driver",
      appliedEventIds: ["e1", "e2", "e3"],
    });
  });

  it("keeps the details of each event", async () => {
    const id = await sessionAfter(authorized, started, stopped);
    const events = await pool.query(
      "SELECT type, payload FROM session_events WHERE session_id = $1 AND event_id = 'e3'",
      [id],
    );
    expect(events.rows).toEqual([
      { type: "stopped", payload: { meterWh: 8200, reason: "driver" } },
    ]);
  });

  it("treats a repeated event as a duplicate and stores it once", async () => {
    const id = await sessionAfter(authorized, started);
    expect(await recordEvent(pool, id, started)).toMatchObject({ ok: true, duplicate: true });

    const count = await pool.query("SELECT count(*)::int AS n FROM session_events");
    expect(count.rows[0].n).toBe(2);
  });

  it("stores the event once when the same message arrives several times at once", async () => {
    const id = await sessionAfter(authorized);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => recordEvent(pool, id, started)),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && !result.duplicate)).toHaveLength(1);
    expect((await findSession(pool, id))?.appliedEventIds).toEqual(["e1", "e2"]);
  });

  it("saves nothing when an event is refused", async () => {
    const id = await sessionAfter();
    expect(await recordEvent(pool, id, started)).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(await findSession(pool, id)).toMatchObject({ state: "requested", appliedEventIds: [] });
  });

  it("reports an unknown session", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await recordEvent(pool, missing, authorized)).toMatchObject({
      ok: false,
      code: "SESSION_NOT_FOUND",
    });
  });
});

describe("recording meter readings", () => {
  const r15 = { readingId: "r15", at: t(15), meterWh: 2800 };
  const r30 = { readingId: "r30", at: t(30), meterWh: 4600 };
  const r45 = { readingId: "r45", at: t(45), meterWh: 6400 };

  it("returns readings in time order whatever order they arrived in", async () => {
    const id = await sessionAfter(authorized, started);
    for (const reading of [r45, r15, r30]) {
      expect(await recordReading(pool, id, reading)).toMatchObject({ ok: true });
    }
    expect(await loadReadings(pool, id)).toEqual([r15, r30, r45]);
  });

  it("accepts a reading that arrives after the session has ended", async () => {
    const id = await sessionAfter(authorized, started, stopped);
    expect(await recordReading(pool, id, r30)).toMatchObject({ ok: true, duplicate: false });
  });

  it("stores a repeated reading once", async () => {
    const id = await sessionAfter(authorized, started);
    await recordReading(pool, id, r15);
    expect(await recordReading(pool, id, r15)).toMatchObject({ ok: true, duplicate: true });
    expect(await loadReadings(pool, id)).toHaveLength(1);
  });

  it("stores nothing when a reading is refused", async () => {
    const id = await sessionAfter(authorized, started);
    await recordReading(pool, id, r30);
    expect(await recordReading(pool, id, { ...r45, meterWh: 2000 })).toMatchObject({
      ok: false,
      code: "INCONSISTENT_READING",
    });
    expect(await loadReadings(pool, id)).toEqual([r30]);
  });

  it("refuses readings before charging has started", async () => {
    const id = await sessionAfter(authorized);
    expect(await recordReading(pool, id, r15)).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });
});
