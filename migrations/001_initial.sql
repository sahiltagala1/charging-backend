-- Chargers, sessions, the events applied to each session, and meter readings.

CREATE TABLE chargers (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id             uuid PRIMARY KEY,
  charger_id     text NOT NULL REFERENCES chargers (id),
  driver_tag     text NOT NULL,
  state          text NOT NULL
                 CHECK (state IN ('requested', 'authorized', 'charging', 'completed', 'rejected', 'faulted')),
  requested_at   timestamptz NOT NULL,
  started_at     timestamptz,
  ended_at       timestamptz,
  meter_start_wh bigint CHECK (meter_start_wh >= 0),
  meter_stop_wh  bigint CHECK (meter_stop_wh >= meter_start_wh),
  end_reason     text
);

-- A charger can have many past sessions but only one that is still open.
-- The database enforces this, so two requests arriving together cannot both win.
CREATE UNIQUE INDEX one_open_session_per_charger
  ON sessions (charger_id)
  WHERE state IN ('requested', 'authorized', 'charging');

CREATE INDEX sessions_by_charger ON sessions (charger_id, requested_at DESC);

-- Every event applied to a session. The primary key is what makes a repeated
-- message harmless: the same event id cannot be stored twice for one session.
CREATE TABLE session_events (
  session_id  uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  event_id    text NOT NULL,
  type        text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_id)
);

CREATE TABLE meter_readings (
  session_id  uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  reading_id  text NOT NULL,
  taken_at    timestamptz NOT NULL,
  meter_wh    bigint NOT NULL CHECK (meter_wh >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, reading_id)
);

CREATE INDEX meter_readings_by_time ON meter_readings (session_id, taken_at);
