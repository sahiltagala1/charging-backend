/**
 * Meter readings taken during a charging session.
 *
 * A charger reports its energy meter every so often while it charges. Those
 * reports can arrive twice, late, or in the wrong order, for example after the
 * charger has been offline. This module keeps a session's readings in a log
 * that ends up the same whatever order they arrived in, and refuses readings
 * that cannot be true.
 *
 * Like the session rules, everything here is a plain function: no database,
 * no network, no clock, nothing mutated and nothing thrown.
 */

import type { Session } from "./session.js";

export type MeterReading = {
  readingId: string;
  at: Date;
  /** The charger's energy meter, in whole watt-hours. */
  meterWh: number;
};

/** A session's readings, always sorted by time. */
export type ReadingLog = readonly MeterReading[];

type Anchor = { at: Date; meterWh: number };

/** The start of a session and, once it has ended, its end. Readings must fit between them. */
export type ReadingBounds = { from: Anchor; to?: Anchor };

export type ReadingRejection =
  "NOT_STARTED" | "INVALID_METER" | "OUTSIDE_SESSION" | "INCONSISTENT_READING";

export type AddReadingResult =
  | { ok: true; log: ReadingLog; duplicate: boolean }
  | { ok: false; code: ReadingRejection; message: string };

export type PowerInterval = { from: Date; to: Date; averageW: number };

const MS_PER_HOUR = 3_600_000;

/** The window readings must fall in. Undefined until the session has started charging. */
export function readingBounds(session: Session): ReadingBounds | undefined {
  if (session.startedAt === undefined || session.meterStartWh === undefined) return undefined;

  const from = { at: session.startedAt, meterWh: session.meterStartWh };
  if (session.endedAt === undefined || session.meterStopWh === undefined) return { from };

  return { from, to: { at: session.endedAt, meterWh: session.meterStopWh } };
}

export function addReading(
  log: ReadingLog,
  reading: MeterReading,
  bounds: ReadingBounds | undefined,
): AddReadingResult {
  if (bounds === undefined) {
    return reject("NOT_STARTED", "Readings are only accepted once charging has started.");
  }
  if (log.some((existing) => existing.readingId === reading.readingId)) {
    return { ok: true, log, duplicate: true };
  }
  if (!Number.isInteger(reading.meterWh) || reading.meterWh < 0) {
    return reject("INVALID_METER", "Meter reading must be a whole number of Wh, zero or more.");
  }

  const time = reading.at.getTime();
  if (time < bounds.from.at.getTime() || (bounds.to && time > bounds.to.at.getTime())) {
    return reject("OUTSIDE_SESSION", "The reading is dated outside the session.");
  }

  // Find where the reading belongs in time, however late it arrived.
  const position = log.findIndex((existing) => existing.at.getTime() > time);
  const index = position === -1 ? log.length : position;

  // An energy meter only counts upwards, so the reading must sit between the
  // one before it and the one after it.
  const before = log[index - 1] ?? bounds.from;
  const after = log[index] ?? bounds.to;
  if (reading.meterWh < before.meterWh || (after && reading.meterWh > after.meterWh)) {
    return reject(
      "INCONSISTENT_READING",
      "The reading does not fit between the readings around it. A meter cannot run backwards.",
    );
  }

  return {
    ok: true,
    log: [...log.slice(0, index), reading, ...log.slice(index)],
    duplicate: false,
  };
}

/** Energy delivered up to the latest reading, in watt-hours. Useful while a session is live. */
export function energySoFarWh(log: ReadingLog, bounds: ReadingBounds): number {
  const latest = bounds.to ?? log.at(-1) ?? bounds.from;
  return latest.meterWh - bounds.from.meterWh;
}

/** Average power between each pair of neighbouring readings, in watts. */
export function powerSeries(log: ReadingLog, bounds: ReadingBounds): PowerInterval[] {
  const points: Anchor[] = [bounds.from, ...log, ...(bounds.to ? [bounds.to] : [])];
  const intervals: PowerInterval[] = [];

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const hours = (to.at.getTime() - from.at.getTime()) / MS_PER_HOUR;
    if (hours === 0) continue; // two readings at the same instant carry no power information

    intervals.push({
      from: from.at,
      to: to.at,
      averageW: Math.round((to.meterWh - from.meterWh) / hours),
    });
  }
  return intervals;
}

function reject(code: ReadingRejection, message: string): AddReadingResult {
  return { ok: false, code, message };
}
