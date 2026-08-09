import { connect } from "cloudflare:sockets";

const GAME_HOST = "game.dragonsgatereborn.com";
const GAME_PORT = 8555;
const CACHE_SECONDS = 30;
const READ_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64000;
const SAMPLE_INTERVAL_SECONDS = 300;
const RETENTION_SECONDS = 90 * 24 * 60 * 60;
let memoryCache = null;
let memoryCachedAt = 0;

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
    message: "Live status is temporarily unavailable.",
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

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeSummary(row = {}) {
  return {
    samples: Number(row.samples || 0),
    uptimePercentage: numberOrNull(row.uptime_percentage),
    averagePlayers: numberOrNull(row.average_players),
    peakPlayers: numberOrNull(row.peak_players),
  };
}

async function getHistory(db) {
  const now = Math.floor(Date.now() / 1000);
  const start24Hours = now - 24 * 60 * 60;
  const start7Days = now - 7 * 24 * 60 * 60;
  const startToday = Math.floor(now / 86400) * 86400;
  const summarySql = `
    SELECT
      COUNT(*) AS samples,
      ROUND(100.0 * AVG(online), 1) AS uptime_percentage,
      ROUND(AVG(CASE WHEN online = 1 THEN player_count END), 1) AS average_players,
      MAX(CASE WHEN online = 1 THEN player_count END) AS peak_players
    FROM live_samples
    WHERE sampled_at >= ?`;

  const results = await db.batch([
    db.prepare(summarySql).bind(start24Hours),
    db.prepare(summarySql).bind(start7Days),
    db.prepare(summarySql).bind(startToday),
    db.prepare("SELECT MIN(sampled_at) AS first_sample, MAX(sampled_at) AS latest_sample, COUNT(*) AS total_samples FROM live_samples"),
    db.prepare(`
      SELECT
        CAST(sampled_at / 3600 AS INTEGER) * 3600 AS bucket,
        ROUND(100.0 * AVG(online), 1) AS uptime_percentage,
        ROUND(AVG(CASE WHEN online = 1 THEN player_count END), 1) AS average_players,
        MAX(CASE WHEN online = 1 THEN player_count END) AS peak_players,
        COUNT(*) AS samples
      FROM live_samples
      WHERE sampled_at >= ?
      GROUP BY bucket
      ORDER BY bucket`).bind(start24Hours),
    db.prepare(`
      SELECT
        CAST(sampled_at / 86400 AS INTEGER) * 86400 AS bucket,
        ROUND(100.0 * AVG(online), 1) AS uptime_percentage,
        ROUND(AVG(CASE WHEN online = 1 THEN player_count END), 1) AS average_players,
        MAX(CASE WHEN online = 1 THEN player_count END) AS peak_players,
        COUNT(*) AS samples
      FROM live_samples
      WHERE sampled_at >= ?
      GROUP BY bucket
      ORDER BY bucket DESC`).bind(start7Days),
  ]);

  const tracking = results[3].results[0] || {};
  const normalizeBuckets = (rows) => rows.map((row) => ({
    timestamp: Number(row.bucket) * 1000,
    uptimePercentage: numberOrNull(row.uptime_percentage),
    averagePlayers: numberOrNull(row.average_players),
    peakPlayers: numberOrNull(row.peak_players),
    samples: Number(row.samples || 0),
  }));

  return {
    generatedAt: new Date().toISOString(),
    trackingSince: tracking.first_sample ? new Date(Number(tracking.first_sample) * 1000).toISOString() : null,
    latestSampleAt: tracking.latest_sample ? new Date(Number(tracking.latest_sample) * 1000).toISOString() : null,
    totalSamples: Number(tracking.total_samples || 0),
    sampleIntervalMinutes: SAMPLE_INTERVAL_SECONDS / 60,
    summary: {
      last24Hours: normalizeSummary(results[0].results[0]),
      last7Days: normalizeSummary(results[1].results[0]),
      today: normalizeSummary(results[2].results[0]),
    },
    hourly: normalizeBuckets(results[4].results),
    daily: normalizeBuckets(results[5].results),
  };
}

export default {
  async fetch(request, env, ctx) {
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

    if (memoryCache && Date.now() - memoryCachedAt < CACHE_SECONDS * 1000) {
      return json(memoryCache);
    }

    const cache = globalThis.caches?.default;
    const cacheKey = new Request(`${url.origin}/status`, { method: "GET" });
    let cached = null;
    try {
      cached = cache ? await cache.match(cacheKey) : null;
    } catch {}
    if (cached) return cached;

    let response;
    try {
      memoryCache = await getLiveWorldStatus();
      memoryCachedAt = Date.now();
      response = json(memoryCache);
      if (env.DB) ctx.waitUntil(storeSample(env.DB, memoryCache));
    } catch {
      const unavailable = offlineStatus();
      response = json(unavailable);
      if (env.DB) ctx.waitUntil(storeSample(env.DB, unavailable));
    }

    try {
      if (cache) await cache.put(cacheKey, response.clone());
    } catch {}
    return response;
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      let status;
      try {
        status = await getLiveWorldStatus();
      } catch {
        status = offlineStatus();
      }
      await storeSample(env.DB, status);
      const cutoff = Math.floor(Date.now() / 1000) - RETENTION_SECONDS;
      await env.DB.prepare("DELETE FROM live_samples WHERE sampled_at < ?").bind(cutoff).run();
    })());
  },
};
