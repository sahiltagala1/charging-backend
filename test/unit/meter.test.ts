import { describe, expect, it } from "vitest";
import {
  addReading,
  energySoFarWh,
  powerSeries,
  readingBounds,
  type MeterReading,
  type ReadingBounds,
  type ReadingLog,
} from "../../src/domain/meter.js";
import {
  applyEvent,
  newSession,
  type Session,
  type SessionEvent,
} from "../../src/domain/session.js";

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));

// A session that starts at minute 0 on 1,000 Wh and stops at minute 60 on 8,200 Wh.
const live: ReadingBounds = { from: { at: t(0), meterWh: 1000 } };
const ended: ReadingBounds = { ...live, to: { at: t(60), meterWh: 8200 } };

const r15: MeterReading = { readingId: "r15", at: t(15), meterWh: 2800 };
const r30: MeterReading = { readingId: "r30", at: t(30), meterWh: 4600 };
const r45: MeterReading = { readingId: "r45", at: t(45), meterWh: 6400 };

/** Adds readings in the order given and fails the test if any is refused. */
function collect(bounds: ReadingBounds, ...readings: MeterReading[]): ReadingLog {
  return readings.reduce<ReadingLog>((log, reading) => {
    const result = addReading(log, reading, bounds);
    if (!result.ok) throw new Error(`${reading.readingId} was refused: ${result.message}`);
    return result.log;
  }, []);
}

describe("adding readings", () => {
  it("keeps readings in time order", () => {
    expect(collect(live, r15, r30, r45).map((r) => r.readingId)).toEqual(["r15", "r30", "r45"]);
  });

  it("gives the same log whatever order the readings arrive in", () => {
    const inOrder = collect(live, r15, r30, r45);
    expect(collect(live, r45, r15, r30)).toEqual(inOrder);
    expect(collect(live, r30, r45, r15)).toEqual(inOrder);
    expect(collect(live, r45, r30, r15)).toEqual(inOrder);
  });

  it("accepts a reading that arrives after the session has ended", () => {
    const log = collect(ended, r15, r45);
    const late = addReading(log, r30, ended);
    expect(late).toMatchObject({ ok: true, duplicate: false });
    expect(late.ok && late.log.map((r) => r.readingId)).toEqual(["r15", "r30", "r45"]);
  });

  it("ignores a reading it has already seen", () => {
    const log = collect(live, r15, r30);
    expect(addReading(log, r15, live)).toEqual({ ok: true, log, duplicate: true });
  });

  it("does not change the log it was given", () => {
    const log = collect(live, r15);
    const copy = structuredClone(log);
    addReading(log, r30, live);
    expect(log).toEqual(copy);
  });
});

describe("readings that cannot be true", () => {
  it("refuses a reading lower than an earlier one", () => {
    const result = addReading(collect(live, r15), { ...r30, meterWh: 2000 }, live);
    expect(result).toMatchObject({ ok: false, code: "INCONSISTENT_READING" });
  });

  it("refuses a late reading higher than a later one", () => {
    const result = addReading(collect(live, r15, r45), { ...r30, meterWh: 7000 }, live);
    expect(result).toMatchObject({ ok: false, code: "INCONSISTENT_READING" });
  });

  it("refuses a reading below the start of the session", () => {
    const result = addReading([], { ...r15, meterWh: 900 }, live);
    expect(result).toMatchObject({ ok: false, code: "INCONSISTENT_READING" });
  });

  it("refuses a reading above the final meter value", () => {
    const result = addReading([], { ...r45, meterWh: 9000 }, ended);
    expect(result).toMatchObject({ ok: false, code: "INCONSISTENT_READING" });
  });

  it.each([
    ["before the session started", t(-5), live],
    ["after the session ended", t(61), ended],
  ])("refuses a reading dated %s", (_label, at, bounds) => {
    expect(addReading([], { ...r15, at }, bounds)).toMatchObject({
      ok: false,
      code: "OUTSIDE_SESSION",
    });
  });

  it.each([-1, 10.5, Number.NaN])("refuses a meter value of %s", (meterWh) => {
    expect(addReading([], { ...r15, meterWh }, live)).toMatchObject({
      ok: false,
      code: "INVALID_METER",
    });
  });

  it("refuses readings before charging has started", () => {
    expect(addReading([], r15, undefined)).toMatchObject({ ok: false, code: "NOT_STARTED" });
  });
});

describe("bounds from a session", () => {
  const authorized: SessionEvent = { type: "authorized", eventId: "e1", at: t(0) };
  const started: SessionEvent = { type: "started", eventId: "e2", at: t(0), meterWh: 1000 };
  const stopped: SessionEvent = {
    type: "stopped",
    eventId: "e3",
    at: t(60),
    meterWh: 8200,
    reason: "driver",
  };

  function sessionAfter(...events: SessionEvent[]): Session {
    const fresh = newSession({ id: "s1", chargerId: "c1", driverTag: "TAG-1", requestedAt: t(0) });
    return events.reduce((session, event) => {
      const result = applyEvent(session, event);
      if (!result.ok) throw new Error(result.message);
      return result.session;
    }, fresh);
  }

  it("has no bounds until charging starts", () => {
    expect(readingBounds(sessionAfter(authorized))).toBeUndefined();
  });

  it("is open-ended while charging", () => {
    expect(readingBounds(sessionAfter(authorized, started))).toEqual(live);
  });

  it("is closed once the session has completed", () => {
    expect(readingBounds(sessionAfter(authorized, started, stopped))).toEqual(ended);
  });
});

describe("energy and power", () => {
  it("reports energy up to the latest reading while live", () => {
    expect(energySoFarWh(collect(live, r15, r30), live)).toBe(3600);
  });

  it("reports zero energy before any reading", () => {
    expect(energySoFarWh([], live)).toBe(0);
  });

  it("reports the full energy once the session has ended", () => {
    expect(energySoFarWh(collect(ended, r15), ended)).toBe(7200);
  });

  it("works out average power between readings", () => {
    // 1,800 Wh every 15 minutes is 7,200 W.
    const series = powerSeries(collect(ended, r15, r30, r45), ended);
    expect(series.map((interval) => interval.averageW)).toEqual([7200, 7200, 7200, 7200]);
    expect(series[0]).toMatchObject({ from: t(0), to: t(15) });
  });

  it("shows an interval where no energy flowed as zero power", () => {
    const stalled: MeterReading = { readingId: "r30", at: t(30), meterWh: 2800 };
    const series = powerSeries(collect(live, r15, stalled), live);
    expect(series.map((interval) => interval.averageW)).toEqual([7200, 0]);
  });

  it("skips two readings taken at the same instant", () => {
    const twin: MeterReading = { readingId: "r15b", at: t(15), meterWh: 2800 };
    expect(powerSeries(collect(live, r15, twin), live)).toHaveLength(1);
  });
});
