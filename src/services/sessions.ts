/**
 * The use cases: start a session, apply an event, record a reading.
 *
 * Each one follows the same steps inside a single transaction:
 * load the current state, ask the domain rules what should happen, save the
 * result. The rules decide; this file only makes sure the decision is made on
 * up-to-date data and saved in one piece.
 */

import { randomUUID } from "node:crypto";
import { isUniqueViolation, withTransaction, type Pool } from "../db/pool.js";
import {
  findCharger,
  findSession,
  insertReading,
  insertSession,
  loadReadings,
  saveSessionChange,
} from "../db/sessionStore.js";
import {
  addReading,
  readingBounds,
  type MeterReading,
  type ReadingLog,
  type ReadingRejection,
} from "../domain/meter.js";
import {
  applyEvent,
  newSession,
  type RejectionCode,
  type Session,
  type SessionEvent,
} from "../domain/session.js";

type Refused<Code extends string> = { ok: false; code: Code; message: string };

export type StartSessionResult =
  { ok: true; session: Session } | Refused<"CHARGER_NOT_FOUND" | "CHARGER_BUSY">;

export type RecordEventResult =
  { ok: true; session: Session; duplicate: boolean } | Refused<"SESSION_NOT_FOUND" | RejectionCode>;

export type RecordReadingResult =
  | { ok: true; log: ReadingLog; duplicate: boolean }
  | Refused<"SESSION_NOT_FOUND" | ReadingRejection>;

export async function startSession(
  pool: Pool,
  input: { chargerId: string; driverTag: string; requestedAt: Date },
): Promise<StartSessionResult> {
  if (!(await findCharger(pool, input.chargerId))) {
    return refuse("CHARGER_NOT_FOUND", `No charger with id "${input.chargerId}".`);
  }

  const session = newSession({ id: randomUUID(), ...input });
  try {
    await insertSession(pool, session);
  } catch (error) {
    // The database allows one open session per charger. If two requests race,
    // the loser lands here.
    if (isUniqueViolation(error, "one_open_session_per_charger")) {
      return refuse("CHARGER_BUSY", "This charger already has a session in progress.");
    }
    throw error;
  }
  return { ok: true, session };
}

export function recordEvent(
  pool: Pool,
  sessionId: string,
  event: SessionEvent,
): Promise<RecordEventResult> {
  return withTransaction(pool, async (tx) => {
    const session = await findSession(tx, sessionId, { lock: true });
    if (!session) return sessionNotFound(sessionId);

    const result = applyEvent(session, event);
    if (result.ok && !result.duplicate) {
      await saveSessionChange(tx, result.session, event);
    }
    return result;
  });
}

export function recordReading(
  pool: Pool,
  sessionId: string,
  reading: MeterReading,
): Promise<RecordReadingResult> {
  return withTransaction(pool, async (tx) => {
    const session = await findSession(tx, sessionId, { lock: true });
    if (!session) return sessionNotFound(sessionId);

    const log = await loadReadings(tx, sessionId);
    const result = addReading(log, reading, readingBounds(session));
    if (result.ok && !result.duplicate) {
      await insertReading(tx, sessionId, reading);
    }
    return result;
  });
}

function sessionNotFound(sessionId: string): Refused<"SESSION_NOT_FOUND"> {
  return refuse("SESSION_NOT_FOUND", `No session with id "${sessionId}".`);
}

function refuse<Code extends string>(code: Code, message: string): Refused<Code> {
  return { ok: false, code, message };
}
