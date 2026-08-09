CREATE TABLE IF NOT EXISTS live_samples (
  sampled_at INTEGER PRIMARY KEY,
  online INTEGER NOT NULL CHECK (online IN (0, 1)),
  player_count INTEGER CHECK (player_count IS NULL OR player_count >= 0)
);

CREATE INDEX IF NOT EXISTS live_samples_sampled_at
  ON live_samples (sampled_at);
