const ALLOWED_ORIGINS = new Set([
  "https://dragonsgatereborn.com",
  "https://www.dragonsgatereborn.com"
]);

function normalizePath(value) {
  let path = typeof value === "string" ? value.trim() : "/";
  try {
    path = new URL(path, "https://dragonsgatereborn.com").pathname;
  } catch {
    path = "/";
  }
  if (!path.startsWith("/")) path = "/" + path;
  if (path === "/index.html") path = "/";
  if (path.length > 300) path = path.slice(0, 300);
  return path;
}

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin)
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "Origin not allowed" }, 403, origin);
      }
      const headers = corsHeaders(origin);
      headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      headers["Access-Control-Allow-Headers"] = "Content-Type";
      headers["Access-Control-Max-Age"] = "86400";
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin);
    }

    if (request.method === "POST" && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin);
    }

    const url = new URL(request.url);
    const path = normalizePath(url.searchParams.get("path") || "/");

    try {
      if (request.method === "POST") {
        const results = await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO page_views (path, views) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET views = views + 1 RETURNING views"
          ).bind(path),
          env.DB.prepare(
            "UPDATE site_views SET views = views + 1 WHERE id = 1 RETURNING views"
          )
        ]);

        return json({
          path,
          pageViews: Number(results[0].results[0].views),
          siteViews: Number(results[1].results[0].views)
        }, 200, origin);
      }

      const results = await env.DB.batch([
        env.DB.prepare("SELECT views FROM page_views WHERE path = ?").bind(path),
        env.DB.prepare("SELECT views FROM site_views WHERE id = 1")
      ]);

      return json({
        path,
        pageViews: Number(results[0].results[0]?.views || 0),
        siteViews: Number(results[1].results[0]?.views || 0)
      }, 200, origin);
    } catch (error) {
      console.error("Counter request failed", error);
      return json({ error: "Counter unavailable" }, 500, origin);
    }
  }
};
