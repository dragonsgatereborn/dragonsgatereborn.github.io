import { connect } from "cloudflare:sockets";

const GAME_HOST = "game.dragonsgatereborn.com";
const GAME_PORT = 8555;
const CACHE_SECONDS = 60;
const READ_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64000;
const SAMPLE_INTERVAL_SECONDS = 300;
const RETENTION_SECONDS = 90 * 24 * 60 * 60;

function responseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=30`,
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(),
  });
}

function stripTerminalFormatting(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function getAdventurerNames(playerList) {
  const sectionMatch = playerList.match(/Current Adventurers\s*([\s\S]*?)\s*You notice/i);
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split("\n")
    .flatMap((line) => line.trim().split(/\s{2,}/))
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter((name) => name.length > 0 && name.length <= 80)
    .filter((name) => /^[\p{L}][\p{L}\p{M}' -]*$/u.test(name));
}

async function readUntil(reader, marker) {
  const decoder = new TextDecoder();
  let output = "";

  while (output.length < MAX_RESPONSE_BYTES) {
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Game server response timed out")), READ_TIMEOUT_MS);
      }),
    ]);

    if (result.done) break;
    output += decoder.decode(result.value, { stream: true });
    if (stripTerminalFormatting(output).includes(marker)) break;
  }

  return stripTerminalFormatting(output);
}

async function getLiveWorldStatus() {
  const socket = connect(
    { hostname: GAME_HOST, port: GAME_PORT },
    { allowHalfOpen: true, secureTransport: "off" },
  );
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Game server connection timed out")), READ_TIMEOUT_MS);
      }),
    ]);
    await readUntil(reader, "Your selection?");
    await writer.write(new TextEncoder().encode("3\r\n"));
    const playerList = await readUntil(reader, "Press enter to continue.");
    const countMatch = playerList.match(/You notice\s+(\d+)\s+adventurers?\./i);

    if (!countMatch) {
      throw new Error("Player count was not present in the game menu response");
    }

    const playerCount = Number(countMatch[1]);
    const parsedNames = getAdventurerNames(playerList);

    return {
      online: true,
      playerCount,
      playerNames: parsedNames.length === playerCount ? parsedNames : [],
      updatedAt: new Date().toISOString(),
    };
  } finally {
    try { socket.close(); } catch {}
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
  }
}

function offlineStatus() {
  return {
    online: false,
    playerCount: null,
    playerNames: [],
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    stale: true,
    message: "Live status is temporarily unavailable.",
  };
}

async function storeCurrentStatus(db, status) {
  if (!db) return;
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO live_status
      (id, online, player_count, player_names, updated_at, checked_at, stale, message)
    VALUES
      (1, ?, ?, ?, ?, ?, 0, NULL)
    ON CONFLICT(id) DO UPDATE SET
      online = excluded.online,
      player_count = excluded.player_count,
      player_names = excluded.player_names,
      updated_at = excluded.updated_at,
      checked_at = excluded.checked_at,
      stale = 0,
      message = NULL
  `).bind(
    status.online ? 1 : 0,
    Number.isInteger(status.playerCount) ? status.playerCount : null,
    JSON.stringify(Array.isArray(status.playerNames) ? status.playerNames : []),
    status.updatedAt || now,
    now,
  ).run();
}

async function markCurrentStatusStale(db) {
  if (!db) return;
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE live_status
    SET checked_at = ?, stale = 1, message = ?
    WHERE id = 1
  `).bind(now, "The latest scheduled check could not reach the game.").run();

  if (!result.meta?.changes) {
    const unavailable = offlineStatus();
    await db.prepare(`
      INSERT INTO live_status
        (id, online, player_count, player_names, updated_at, checked_at, stale, message)
      VALUES
        (1, 0, NULL, '[]', ?, ?, 1, ?)
    `).bind(unavailable.updatedAt, now, unavailable.message).run();
  }
}

async function getCurrentStatus(db) {
  const row = await db.prepare(`
    SELECT online, player_count, player_names, updated_at, checked_at, stale, message
    FROM live_status
    WHERE id = 1
  `).first();
  if (!row) return null;

  let playerNames = [];
  try {
    const parsed = JSON.parse(row.player_names || "[]");
    if (Array.isArray(parsed)) playerNames = parsed;
  } catch {}

  return {
    online: Boolean(row.online),
    playerCount: row.player_count === null ? null : Number(row.player_count),
    playerNames,
    updatedAt: row.updated_at,
    checkedAt: row.checked_at,
    stale: Boolean(row.stale),
    ...(row.message ? { message: row.message } : {}),
  };
}

async function storeSample(db, status) {
  if (!db) return;
  const now = Math.floor(Date.now() / 1000);
  const sampledAt = Math.floor(now / SAMPLE_INTERVAL_SECONDS) * SAMPLE_INTERVAL_SECONDS;
  const playerCount = status.online && Number.isInteger(status.playerCount)
    ? status.playerCount
    : null;

  await db.prepare(
    "INSERT INTO live_samples (sampled_at, online, player_count) VALUES (?, ?, ?) " +
    "ON CONFLICT(sampled_at) DO UPDATE SET online = excluded.online, player_count = excluded.player_count",
  ).bind(sampledAt, status.online ? 1 : 0, playerCount).run();
}

async function refreshRollups(db, sampledAt = Math.floor(Date.now() / 1000)) {
  if (!db) return;
  const hourAt = Math.floor(sampledAt / 3600) * 3600;
  const dayAt = Math.floor(sampledAt / 86400) * 86400;
  const aggregateSql = (bucketColumn) => `
    INSERT INTO ${bucketColumn === "hour_at" ? "live_hourly_rollups" : "live_daily_rollups"}
      (${bucketColumn}, samples, online_samples, player_count_sum, player_count_samples, peak_players, active_samples)
    SELECT
      ?, COUNT(*), SUM(online),
      COALESCE(SUM(CASE WHEN online = 1 THEN player_count ELSE 0 END), 0),
      SUM(CASE WHEN online = 1 AND player_count IS NOT NULL THEN 1 ELSE 0 END),
      MAX(CASE WHEN online = 1 THEN player_count END),
      SUM(CASE WHEN online = 1 AND player_count > 0 THEN 1 ELSE 0 END)
    FROM live_samples
    WHERE sampled_at >= ? AND sampled_at < ?
    ON CONFLICT(${bucketColumn}) DO UPDATE SET
      samples = excluded.samples,
      online_samples = excluded.online_samples,
      player_count_sum = excluded.player_count_sum,
      player_count_samples = excluded.player_count_samples,
      peak_players = excluded.peak_players,
      active_samples = excluded.active_samples`;

  await db.batch([
    db.prepare(aggregateSql("hour_at")).bind(hourAt, hourAt, hourAt + 3600),
    db.prepare(aggregateSql("day_at")).bind(dayAt, dayAt, dayAt + 86400),
  ]);
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeSummary(row = {}) {
  return {
    samples: Number(row.samples || 0),
    uptimePercentage: numberOrNull(row.uptime_percentage),
    averagePlayers: numberOrNull(row.average_players),
    peakPlayers: numberOrNull(row.peak_players),
    playerHours: numberOrNull(row.player_hours),
    activePercentage: numberOrNull(row.active_percentage),
  };
}

async function getHistory(db) {
  const now = Math.floor(Date.now() / 1000);
  const start24Hours = now - 24 * 60 * 60;
  const start7Days = now - 7 * 24 * 60 * 60;
  const start14Days = now - 14 * 24 * 60 * 60;
  const start30Days = now - 30 * 24 * 60 * 60;
  const start60Days = now - 60 * 24 * 60 * 60;
  const start90Days = now - 90 * 24 * 60 * 60;
  const rawSummarySql = `
    SELECT
      COUNT(*) AS samples,
      ROUND(100.0 * AVG(online), 1) AS uptime_percentage,
      ROUND(AVG(CASE WHEN online = 1 THEN player_count END), 1) AS average_players,
      MAX(CASE WHEN online = 1 THEN player_count END) AS peak_players,
      ROUND(SUM(CASE WHEN online = 1 THEN player_count ELSE 0 END) / 12.0, 1) AS player_hours,
      ROUND(100.0 * AVG(CASE WHEN online = 1 AND player_count > 0 THEN 1 ELSE 0 END), 1) AS active_percentage
    FROM live_samples
    WHERE sampled_at >= ? AND sampled_at < ?`;
  const rollupSummarySql = `
    SELECT
      COALESCE(SUM(samples), 0) AS samples,
      ROUND(100.0 * SUM(online_samples) / NULLIF(SUM(samples), 0), 1) AS uptime_percentage,
      ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players,
      MAX(peak_players) AS peak_players,
      ROUND(SUM(player_count_sum) / 12.0, 1) AS player_hours,
      ROUND(100.0 * SUM(active_samples) / NULLIF(SUM(samples), 0), 1) AS active_percentage
    FROM live_daily_rollups
    WHERE day_at >= ?`;
  const groupedRollupSql = (bucketExpression, limitClause = "") => `
    SELECT
      ${bucketExpression} AS bucket,
      SUM(samples) AS samples,
      ROUND(100.0 * SUM(online_samples) / NULLIF(SUM(samples), 0), 1) AS uptime_percentage,
      ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players,
      MAX(peak_players) AS peak_players,
      ROUND(SUM(player_count_sum) / 12.0, 1) AS player_hours,
      ROUND(100.0 * SUM(active_samples) / NULLIF(SUM(samples), 0), 1) AS active_percentage
    FROM live_daily_rollups
    GROUP BY bucket
    ORDER BY bucket DESC
    ${limitClause}`;

  const results = await db.batch([
    db.prepare(rawSummarySql).bind(start24Hours, now),
    db.prepare(rawSummarySql).bind(start7Days, now),
    db.prepare(rawSummarySql).bind(start14Days, start7Days),
    db.prepare(rawSummarySql).bind(start30Days, now),
    db.prepare(rawSummarySql).bind(start60Days, start30Days),
    db.prepare(rawSummarySql).bind(start90Days, now),
    db.prepare(rollupSummarySql).bind(0),
    db.prepare("SELECT MIN(day_at) AS first_sample, (SELECT MAX(sampled_at) FROM live_samples) AS latest_sample, SUM(samples) AS total_samples FROM live_daily_rollups"),
    db.prepare(`
      SELECT hour_at AS bucket, samples,
        ROUND(100.0 * online_samples / NULLIF(samples, 0), 1) AS uptime_percentage,
        ROUND(1.0 * player_count_sum / NULLIF(player_count_samples, 0), 1) AS average_players,
        peak_players,
        ROUND(player_count_sum / 12.0, 1) AS player_hours,
        ROUND(100.0 * active_samples / NULLIF(samples, 0), 1) AS active_percentage
      FROM live_hourly_rollups
      WHERE hour_at >= ?
      ORDER BY hour_at`).bind(Math.floor(start24Hours / 3600) * 3600),
    db.prepare(`
      SELECT day_at AS bucket, samples,
        ROUND(100.0 * online_samples / NULLIF(samples, 0), 1) AS uptime_percentage,
        ROUND(1.0 * player_count_sum / NULLIF(player_count_samples, 0), 1) AS average_players,
        peak_players,
        ROUND(player_count_sum / 12.0, 1) AS player_hours,
        ROUND(100.0 * active_samples / NULLIF(samples, 0), 1) AS active_percentage
      FROM live_daily_rollups
      ORDER BY day_at DESC
      LIMIT 14`),
    db.prepare(groupedRollupSql("day_at - (((CAST(strftime('%w', day_at, 'unixepoch') AS INTEGER) + 6) % 7) * 86400)", "LIMIT 13")),
    db.prepare(groupedRollupSql("CAST(strftime('%s', datetime(day_at, 'unixepoch', 'start of month')) AS INTEGER)", "LIMIT 13")),
    db.prepare(groupedRollupSql("CAST(strftime('%s', strftime('%Y-01-01', day_at, 'unixepoch')) AS INTEGER)")),
    db.prepare("SELECT MAX(peak_players) AS all_time_peak FROM live_daily_rollups"),
    db.prepare(`
      SELECT day_at AS bucket, samples,
        ROUND(1.0 * player_count_sum / NULLIF(player_count_samples, 0), 1) AS average_players,
        peak_players, ROUND(player_count_sum / 12.0, 1) AS player_hours
      FROM live_daily_rollups
      ORDER BY player_count_sum DESC, peak_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT hour_at AS bucket, samples,
        ROUND(1.0 * player_count_sum / NULLIF(player_count_samples, 0), 1) AS average_players,
        peak_players, ROUND(player_count_sum / 12.0, 1) AS player_hours
      FROM live_hourly_rollups
      WHERE samples >= 6
      ORDER BY (1.0 * player_count_sum / NULLIF(player_count_samples, 0)) DESC, peak_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT CAST(strftime('%w', day_at, 'unixepoch') AS INTEGER) AS weekday,
        ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players
      FROM live_daily_rollups
      GROUP BY weekday
      ORDER BY average_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT CAST(strftime('%H', hour_at, 'unixepoch') AS INTEGER) AS hour,
        ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players
      FROM live_hourly_rollups
      GROUP BY hour
      ORDER BY average_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT day_at AS bucket, samples,
        ROUND(1.0 * player_count_sum / NULLIF(player_count_samples, 0), 1) AS average_players,
        peak_players, ROUND(player_count_sum / 12.0, 1) AS player_hours
      FROM live_daily_rollups
      WHERE samples >= 144
      ORDER BY (1.0 * player_count_sum / NULLIF(player_count_samples, 0)) DESC, peak_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT
        day_at - (((CAST(strftime('%w', day_at, 'unixepoch') AS INTEGER) + 6) % 7) * 86400) AS bucket,
        SUM(samples) AS samples,
        ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players,
        MAX(peak_players) AS peak_players,
        ROUND(SUM(player_count_sum) / 12.0, 1) AS player_hours
      FROM live_daily_rollups
      GROUP BY bucket
      HAVING SUM(samples) >= 864
      ORDER BY (1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0)) DESC, peak_players DESC
      LIMIT 1`),
    db.prepare(`
      SELECT
        CAST(strftime('%s', strftime('%Y-01-01', day_at, 'unixepoch')) AS INTEGER) AS bucket,
        SUM(samples) AS samples,
        ROUND(1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0), 1) AS average_players,
        MAX(peak_players) AS peak_players,
        ROUND(SUM(player_count_sum) / 12.0, 1) AS player_hours
      FROM live_daily_rollups
      GROUP BY bucket
      ORDER BY (1.0 * SUM(player_count_sum) / NULLIF(SUM(player_count_samples), 0)) DESC, peak_players DESC
      LIMIT 1`),
  ]);

  const tracking = results[7].results[0] || {};
  const normalizeBuckets = (rows) => rows.map((row) => ({
    timestamp: Number(row.bucket) * 1000,
    uptimePercentage: numberOrNull(row.uptime_percentage),
    averagePlayers: numberOrNull(row.average_players),
    peakPlayers: numberOrNull(row.peak_players),
    samples: Number(row.samples || 0),
    playerHours: numberOrNull(row.player_hours),
    activePercentage: numberOrNull(row.active_percentage),
  }));
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const busiestDay = results[14].results[0] || null;
  const busiestHour = results[15].results[0] || null;
  const popularWeekday = results[16].results[0] || null;
  const popularHour = results[17].results[0] || null;
  const peakDayAverage = results[18].results[0] || null;
  const peakWeekAverage = results[19].results[0] || null;
  const peakYearAverage = results[20].results[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    trackingSince: tracking.first_sample ? new Date(Number(tracking.first_sample) * 1000).toISOString() : null,
    latestSampleAt: tracking.latest_sample ? new Date(Number(tracking.latest_sample) * 1000).toISOString() : null,
    totalSamples: Number(tracking.total_samples || 0),
    sampleIntervalMinutes: SAMPLE_INTERVAL_SECONDS / 60,
    summary: {
      last24Hours: normalizeSummary(results[0].results[0]),
      last7Days: normalizeSummary(results[1].results[0]),
      previous7Days: normalizeSummary(results[2].results[0]),
      last30Days: normalizeSummary(results[3].results[0]),
      previous30Days: normalizeSummary(results[4].results[0]),
      last90Days: normalizeSummary(results[5].results[0]),
      allTime: normalizeSummary(results[6].results[0]),
    },
    hourly: normalizeBuckets(results[8].results),
    daily: normalizeBuckets(results[9].results),
    weekly: normalizeBuckets(results[10].results),
    monthly: normalizeBuckets(results[11].results),
    yearly: normalizeBuckets(results[12].results),
    records: {
      allTimePeak: numberOrNull(results[13].results[0]?.all_time_peak),
      busiestDay: busiestDay ? normalizeBuckets([busiestDay])[0] : null,
      busiestHour: busiestHour ? normalizeBuckets([busiestHour])[0] : null,
      popularWeekday: popularWeekday ? {
        name: weekdays[Number(popularWeekday.weekday)],
        averagePlayers: numberOrNull(popularWeekday.average_players),
      } : null,
      popularHour: popularHour ? {
        hourUtc: Number(popularHour.hour),
        averagePlayers: numberOrNull(popularHour.average_players),
      } : null,
      peakDayAverage: peakDayAverage ? normalizeBuckets([peakDayAverage])[0] : null,
      peakWeekAverage: peakWeekAverage ? normalizeBuckets([peakWeekAverage])[0] : null,
      peakYearAverage: peakYearAverage ? normalizeBuckets([peakYearAverage])[0] : null,
    },
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders() });
    }

    const url = new URL(request.url);
    if (request.method !== "GET" || !["/", "/status", "/history"].includes(url.pathname)) {
      return json({ error: "Not found" }, 404);
    }

    if (url.pathname === "/history") {
      if (!env.DB) return json({ error: "History is temporarily unavailable" }, 503);
      try {
        return json(await getHistory(env.DB));
      } catch {
        return json({ error: "History is temporarily unavailable" }, 503);
      }
    }

    if (!env.DB) return json(offlineStatus(), 503);
    try {
      const current = await getCurrentStatus(env.DB);
      return current ? json(current) : json(offlineStatus(), 503);
    } catch {
      return json(offlineStatus(), 503);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      let status;
      try {
        status = await getLiveWorldStatus();
        await storeSample(env.DB, status);
        await Promise.all([storeCurrentStatus(env.DB, status), refreshRollups(env.DB)]);
      } catch {
        status = offlineStatus();
        await storeSample(env.DB, status);
        await Promise.all([markCurrentStatusStale(env.DB), refreshRollups(env.DB)]);
      }
      const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS;
      await env.DB.prepare("DELETE FROM live_samples WHERE sampled_at < ?").bind(cutoff).run();
    })());
  },
};
