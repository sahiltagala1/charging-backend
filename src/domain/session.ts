/**
 * The rules of a charging session, with no database, network or clock.
 *
 * A session only ever changes by applying an event to it. `applyEvent` takes
 * the current session and one event and returns either the next session or a
 * reason the event is not allowed. Nothing here is mutated and nothing throws,
 * so every rule can be tested with plain values.
 */

export const SESSION_STATES = ["requested", "authorized", "charging", "completed", "rejected", "faulted"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export type StopReason = "driver" | "charger" | "remote";

export type SessionEvent =
  | { type: "authorized"; eventId: string; at: Date }
  | { type: "rejected"; eventId: string; at: Date; reason: string }
  | { type: "started"; eventId: string; at: Date; meterWh: number }
  | { type: "stopped"; eventId: string; at: Date; meterWh: number; reason: StopReason }
  | { type: "faulted"; eventId: string; at: Date; code: string };

export type Session = {
  id: string;
  chargerId: string;
  driverTag: string;
  state: SessionState;
  requestedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  /** The charger's energy meter, in watt-hours, when charging started and stopped. */
  meterStartWh?: number;
  meterStopWh?: number;
  endReason?: string;
  /** Ids of the events already applied, so a repeated message changes nothing. */
  appliedEventIds: readonly string[];
};

export type RejectionCode = "INVALID_TRANSITION" | "INVALID_METER" | "METER_WENT_BACKWARDS" | "TIME_WENT_BACKWARDS";

export type ApplyResult =
  | { ok: true; session: Session; duplicate: boolean }
  | { ok: false; code: RejectionCode; message: string };

/** Which events each state accepts, and the state each one leads to. */
const TRANSITIONS: Record<SessionState, Partial<Record<SessionEvent["type"], SessionState>>> = {
  requested: { authorized: "authorized", rejected: "rejected" },
  authorized: { started: "charging", faulted: "faulted" },
  charging: { stopped: "completed", faulted: "faulted" },
  completed: {},
  rejected: {},
  faulted: {},
};

export function newSession(input: { id: string; chargerId: string; driverTag: string; requestedAt: Date }): Session {
  return { ...input, state: "requested", appliedEventIds: [] };
}

export function isFinished(session: Session): boolean {
  return Object.keys(TRANSITIONS[session.state]).length === 0;
}

export function applyEvent(session: Session, event: SessionEvent): ApplyResult {
  // Chargers resend messages when they do not hear back. Applying the same
  // event twice must leave the session exactly as it was.
  if (session.appliedEventIds.includes(event.eventId)) {
    return { ok: true, session, duplicate: true };
  }

  const next = TRANSITIONS[session.state][event.type];
  if (!next) {
    return reject("INVALID_TRANSITION", `A ${session.state} session cannot accept "${event.type}".`);
  }

  const lastChange = session.endedAt ?? session.startedAt ?? session.requestedAt;
  if (event.at.getTime() < lastChange.getTime()) {
    return reject("TIME_WENT_BACKWARDS", `"${event.type}" is dated before the session's last change.`);
  }

  const base: Session = { ...session, state: next, appliedEventIds: [...session.appliedEventIds, event.eventId] };

  switch (event.type) {
    case "authorized":
      return accept(base);
    case "rejected":
      return accept({ ...base, endedAt: event.at, endReason: event.reason });
    case "started":
      if (!isValidMeter(event.meterWh)) return reject("INVALID_METER", "Meter reading must be a whole number of Wh, zero or more.");
      return accept({ ...base, startedAt: event.at, meterStartWh: event.meterWh });
    case "stopped":
      if (!isValidMeter(event.meterWh)) return reject("INVALID_METER", "Meter reading must be a whole number of Wh, zero or more.");
      if (event.meterWh < (session.meterStartWh ?? 0)) {
        return reject("METER_WENT_BACKWARDS", "The stop reading is lower than the start reading.");
      }
      return accept({ ...base, endedAt: event.at, meterStopWh: event.meterWh, endReason: event.reason });
    case "faulted":
      return accept({ ...base, endedAt: event.at, endReason: `fault:${event.code}` });
  }
}

/** Energy delivered, in watt-hours. Only known once a session has completed. */
export function energyDeliveredWh(session: Session): number | undefined {
  if (session.state !== "completed" || session.meterStartWh === undefined || session.meterStopWh === undefined) {
    return undefined;
  }
  return session.meterStopWh - session.meterStartWh;
}

function isValidMeter(wh: number): boolean {
  return Number.isInteger(wh) && wh >= 0;
}

function accept(session: Session): ApplyResult {
  return { ok: true, session, duplicate: false };
}

function reject(code: RejectionCode, message: string): ApplyResult {
  return { ok: false, code, message };
}
