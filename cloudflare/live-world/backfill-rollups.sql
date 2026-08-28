INSERT INTO live_hourly_rollups
  (hour_at, samples, online_samples, player_count_sum, player_count_samples, peak_players, active_samples)
SELECT
  CAST(sampled_at / 3600 AS INTEGER) * 3600,
  COUNT(*),
  SUM(online),
  COALESCE(SUM(CASE WHEN online = 1 THEN player_count ELSE 0 END), 0),
  SUM(CASE WHEN online = 1 AND player_count IS NOT NULL THEN 1 ELSE 0 END),
  MAX(CASE WHEN online = 1 THEN player_count END),
  SUM(CASE WHEN online = 1 AND player_count > 0 THEN 1 ELSE 0 END)
FROM live_samples
GROUP BY CAST(sampled_at / 3600 AS INTEGER) * 3600
ON CONFLICT(hour_at) DO UPDATE SET
  samples = excluded.samples,
  online_samples = excluded.online_samples,
  player_count_sum = excluded.player_count_sum,
  player_count_samples = excluded.player_count_samples,
  peak_players = excluded.peak_players,
  active_samples = excluded.active_samples;

INSERT INTO live_daily_rollups
  (day_at, samples, online_samples, player_count_sum, player_count_samples, peak_players, active_samples)
SELECT
  CAST(sampled_at / 86400 AS INTEGER) * 86400,
  COUNT(*),
  SUM(online),
  COALESCE(SUM(CASE WHEN online = 1 THEN player_count ELSE 0 END), 0),
  SUM(CASE WHEN online = 1 AND player_count IS NOT NULL THEN 1 ELSE 0 END),
  MAX(CASE WHEN online = 1 THEN player_count END),
  SUM(CASE WHEN online = 1 AND player_count > 0 THEN 1 ELSE 0 END)
FROM live_samples
GROUP BY CAST(sampled_at / 86400 AS INTEGER) * 86400
ON CONFLICT(day_at) DO UPDATE SET
  samples = excluded.samples,
  online_samples = excluded.online_samples,
  player_count_sum = excluded.player_count_sum,
  player_count_samples = excluded.player_count_samples,
  peak_players = excluded.peak_players,
  active_samples = excluded.active_samples;
