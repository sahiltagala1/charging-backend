import { describe, expect, it } from "vitest";
import {
  SESSION_STATES, applyEvent, energyDeliveredWh, isFinished, newSession,
  type Session, type SessionEvent,
} from "../src/domain/session.js";

const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes));
const fresh = () => newSession({ id: "s1", chargerId: "c1", driverTag: "TAG-1", requestedAt: t(0) });

const authorized: SessionEvent = { type: "authorized", eventId: "e1", at: t(1) };
const started: SessionEvent = { type: "started", eventId: "e2", at: t(2), meterWh: 1000 };
const stopped: SessionEvent = { type: "stopped", eventId: "e3", at: t(62), meterWh: 8200, reason: "driver" };

/** Applies events in order and fails the test if any is refused. */
function run(session: Session, ...events: SessionEvent[]): Session {
  return events.reduce((s, e) => {
    const r = applyEvent(s, e);
    if (!r.ok) throw new Error(`${e.type} was refused: ${r.message}`);
    return r.session;
  }, session);
}

describe("a normal session", () => {
  it("goes requested, authorized, charging, completed", () => {
    const s = run(fresh(), authorized, started, stopped);
    expect(s.state).toBe("completed");
    expect(s.startedAt).toEqual(t(2));
    expect(s.endedAt).toEqual(t(62));
    expect(s.endReason).toBe("driver");
  });

  it("reports the energy delivered once completed", () => {
    expect(energyDeliveredWh(run(fresh(), authorized, started, stopped))).toBe(7200);
  });

  it("does not report energy while still charging", () => {
    expect(energyDeliveredWh(run(fresh(), authorized, started))).toBeUndefined();
  });

  it("never changes the session it was given", () => {
    const before = fresh();
    const copy = structuredClone(before);
    applyEvent(before, authorized);
    expect(before).toEqual(copy);
  });
});

describe("events out of turn", () => {
  it("cannot start charging before authorisation", () => {
    expect(applyEvent(fresh(), started)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("cannot stop a session that never started", () => {
    expect(applyEvent(run(fresh(), authorized), stopped)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("accepts nothing once finished", () => {
    const done = run(fresh(), authorized, started, stopped);
    const again: SessionEvent = { type: "started", eventId: "e9", at: t(70), meterWh: 9000 };
    expect(applyEvent(done, again)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  it("every state accepts only the events listed for it", () => {
    // A guard against someone adding a state and forgetting its rules.
    const reachable = new Set<string>(["requested"]);
    const samples: SessionEvent[] = [
      authorized, started, stopped,
      { type: "rejected", eventId: "r", at: t(1), reason: "unknown tag" },
      { type: "faulted", eventId: "f", at: t(3), code: "GroundFailure" },
    ];
    const walk = (s: Session) => {
      for (const e of samples) {
        const r = applyEvent(s, { ...e, eventId: `${s.state}-${e.type}` });
        if (r.ok && !reachable.has(`${s.state}>${r.session.state}`)) {
          reachable.add(`${s.state}>${r.session.state}`);
          reachable.add(r.session.state);
          walk(r.session);
        }
      }
    };
    walk(fresh());
    for (const state of SESSION_STATES) expect(reachable).toContain(state);
  });
});

describe("rejection and faults", () => {
  it("a rejected tag ends the session with the reason", () => {
    const s = run(fresh(), { type: "rejected", eventId: "e1", at: t(1), reason: "unknown tag" });
    expect(s).toMatchObject({ state: "rejected", endReason: "unknown tag" });
    expect(isFinished(s)).toBe(true);
  });

  it("a fault while charging ends the session and records the code", () => {
    const s = run(fresh(), authorized, started, { type: "faulted", eventId: "e3", at: t(10), code: "GroundFailure" });
    expect(s).toMatchObject({ state: "faulted", endReason: "fault:GroundFailure" });
    expect(energyDeliveredWh(s)).toBeUndefined();
  });
});

describe("duplicate messages", () => {
  it("applying the same event twice changes nothing", () => {
    const once = run(fresh(), authorized, started);
    const twice = applyEvent(once, started);
    expect(twice).toEqual({ ok: true, session: once, duplicate: true });
  });

  it("a repeated stop does not end the session a second time", () => {
    const done = run(fresh(), authorized, started, stopped);
    expect(applyEvent(done, stopped)).toMatchObject({ ok: true, duplicate: true });
  });
});

describe("bad readings", () => {
  const charging = () => run(fresh(), authorized, started);

  it("refuses a stop reading below the start reading", () => {
    const r = applyEvent(charging(), { ...stopped, meterWh: 999 });
    expect(r).toMatchObject({ ok: false, code: "METER_WENT_BACKWARDS" });
  });

  it("accepts a stop reading equal to the start reading (no energy delivered)", () => {
    const s = run(charging(), { ...stopped, meterWh: 1000 });
    expect(energyDeliveredWh(s)).toBe(0);
  });

  it.each([-1, 10.5, Number.NaN])("refuses a meter reading of %s", (meterWh) => {
    const r = applyEvent(run(fresh(), authorized), { ...started, meterWh });
    expect(r).toMatchObject({ ok: false, code: "INVALID_METER" });
  });

  it("refuses an event dated before the previous one", () => {
    const r = applyEvent(charging(), { ...stopped, at: t(1) });
    expect(r).toMatchObject({ ok: false, code: "TIME_WENT_BACKWARDS" });
  });
});
