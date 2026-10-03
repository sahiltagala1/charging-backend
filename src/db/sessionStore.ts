/**
 * Reads and writes for chargers, sessions, events and readings.
 *
 * This file only translates between database rows and the domain types. It
 * makes no decisions: the rules live in `src/domain/`.
 */

import type { MeterReading, ReadingLog } from "../domain/meter.js";
import type { Session, SessionEvent, SessionState } from "../domain/session.js";
import type { Queryable } from "./pool.js";

export type Charger = { id: string; name: string };

type SessionRow = {
  id: string;
  charger_id: string;
  driver_tag: string;
  state: SessionState;
  requested_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  // Postgres returns bigint columns as strings.
  meter_start_wh: string | null;
  meter_stop_wh: string | null;
  end_reason: string | null;
};

export async function insertCharger(db: Queryable, charger: Charger): Promise<boolean> {
  const result = await db.query(
    "INSERT INTO chargers (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [charger.id, charger.name],
  );
  return result.rowCount === 1;
}

export async function findCharger(db: Queryable, id: string): Promise<Charger | undefined> {
  const result = await db.query<Charger>("SELECT id, name FROM chargers WHERE id = $1", [id]);
  return result.rows[0];
}

export async function listChargers(db: Queryable): Promise<Charger[]> {
  const result = await db.query<Charger>("SELECT id, name FROM chargers ORDER BY id");
  return result.rows;
}

export async function insertSession(db: Queryable, session: Session): Promise<void> {
  await db.query(
    `INSERT INTO sessions (id, charger_id, driver_tag, state, requested_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [session.id, session.chargerId, session.driverTag, session.state, session.requestedAt],
  );
}

/**
 * Loads a session with the ids of the events already applied to it.
 * With `lock`, the row is held until the surrounding transaction ends, so two
 * requests for the same session are handled one after the other.
 */
export async function findSession(
  db: Queryable,
  id: string,
  options: { lock?: boolean } = {},
): Promise<Session | undefined> {
  const found = await db.query<SessionRow>(
    `SELECT * FROM sessions WHERE id = $1 ${options.lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  const row = found.rows[0];
  if (!row) return undefined;

  const events = await db.query<{ event_id: string }>(
    "SELECT event_id FROM session_events WHERE session_id = $1 ORDER BY received_at, event_id",
    [id],
  );
  return toSession(
    row,
    events.rows.map((event) => event.event_id),
  );
}

/** Saves the new state of a session together with the event that caused it. */
export async function saveSessionChange(
  db: Queryable,
  session: Session,
  event: SessionEvent,
): Promise<void> {
  await db.query(
    `UPDATE sessions
        SET state = $2, started_at = $3, ended_at = $4,
            meter_start_wh = $5, meter_stop_wh = $6, end_reason = $7
      WHERE id = $1`,
    [
      session.id,
      session.state,
      session.startedAt ?? null,
      session.endedAt ?? null,
      session.meterStartWh ?? null,
      session.meterStopWh ?? null,
      session.endReason ?? null,
    ],
  );

  const { eventId, type, at, ...payload } = event;
  await db.query(
    `INSERT INTO session_events (session_id, event_id, type, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [session.id, eventId, type, at, JSON.stringify(payload)],
  );
}

export async function loadReadings(db: Queryable, sessionId: string): Promise<ReadingLog> {
  const result = await db.query<{ reading_id: string; taken_at: Date; meter_wh: string }>(
    `SELECT reading_id, taken_at, meter_wh
       FROM meter_readings
      WHERE session_id = $1
      ORDER BY taken_at, meter_wh, reading_id`,
    [sessionId],
  );
  return result.rows.map((row) => ({
    readingId: row.reading_id,
    at: row.taken_at,
    meterWh: Number(row.meter_wh),
  }));
}

export async function insertReading(
  db: Queryable,
  sessionId: string,
  reading: MeterReading,
): Promise<void> {
  await db.query(
    "INSERT INTO meter_readings (session_id, reading_id, taken_at, meter_wh) VALUES ($1, $2, $3, $4)",
    [sessionId, reading.readingId, reading.at, reading.meterWh],
  );
}

function toSession(row: SessionRow, appliedEventIds: string[]): Session {
  return {
    id: row.id,
    chargerId: row.charger_id,
    driverTag: row.driver_tag,
    state: row.state,
    requestedAt: row.requested_at,
    appliedEventIds,
    ...(row.started_at && { startedAt: row.started_at }),
    ...(row.ended_at && { endedAt: row.ended_at }),
    ...(row.meter_start_wh !== null && { meterStartWh: Number(row.meter_start_wh) }),
    ...(row.meter_stop_wh !== null && { meterStopWh: Number(row.meter_stop_wh) }),
    ...(row.end_reason !== null && { endReason: row.end_reason }),
  };
}
