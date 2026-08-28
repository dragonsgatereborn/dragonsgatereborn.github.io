CREATE TABLE IF NOT EXISTS live_samples (
  sampled_at INTEGER PRIMARY KEY,
  online INTEGER NOT NULL CHECK (online IN (0, 1)),
  player_count INTEGER CHECK (player_count IS NULL OR player_count >= 0)
);

CREATE INDEX IF NOT EXISTS live_samples_sampled_at
  ON live_samples (sampled_at);

CREATE TABLE IF NOT EXISTS live_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  online INTEGER NOT NULL CHECK (online IN (0, 1)),
  player_count INTEGER CHECK (player_count IS NULL OR player_count >= 0),
  player_names TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0 CHECK (stale IN (0, 1)),
  message TEXT
);

CREATE TABLE IF NOT EXISTS live_hourly_rollups (
  hour_at INTEGER PRIMARY KEY,
  samples INTEGER NOT NULL,
  online_samples INTEGER NOT NULL,
  player_count_sum INTEGER NOT NULL,
  player_count_samples INTEGER NOT NULL,
  peak_players INTEGER,
  active_samples INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS live_daily_rollups (
  day_at INTEGER PRIMARY KEY,
  samples INTEGER NOT NULL,
  online_samples INTEGER NOT NULL,
  player_count_sum INTEGER NOT NULL,
  player_count_samples INTEGER NOT NULL,
  peak_players INTEGER,
  active_samples INTEGER NOT NULL
);
