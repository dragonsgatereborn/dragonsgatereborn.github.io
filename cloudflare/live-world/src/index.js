import { connect } from "cloudflare:sockets";

const GAME_HOST = "game.dragonsgatereborn.com";
const GAME_PORT = 8555;
const CACHE_SECONDS = 30;
const READ_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64000;
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

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders() });
    }

    const url = new URL(request.url);
    if (request.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/status")) {
      return json({ error: "Not found" }, 404);
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
    } catch {
      response = json({
        online: false,
        playerCount: null,
        updatedAt: new Date().toISOString(),
        message: "Live status is temporarily unavailable.",
      });
    }

    try {
      if (cache) await cache.put(cacheKey, response.clone());
    } catch {}
    return response;
  },
};
