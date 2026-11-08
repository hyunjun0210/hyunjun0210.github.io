const ARTWORK_IDS = new Set([
  "photo-night",
  "animation-short",
  "poster",
]);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase environment is not configured.");
  return { url, key };
}

// 각 작품의 누적 응원 수와 최근 반응 시각을 한 번에 읽는다.
// 응원 1건 = 행 1개로 저장되어 있으므로, 행을 세어 집계한다(덮어쓰기 아님).
async function readStats(config) {
  const entries = await Promise.all([...ARTWORK_IDS].map(async artworkId => {
    // 누적 횟수: count=exact 로 전체 행 수를 센다.
    const countQuery = new URLSearchParams({ artwork_id: `eq.${artworkId}`, select: "id" });
    const countResponse = await fetch(`${config.url}/rest/v1/reactions?${countQuery}`, {
      method: "HEAD",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    if (!countResponse.ok) throw new Error("Could not read reaction count.");
    const range = countResponse.headers.get("content-range");
    const total = range?.split("/")[1];
    if (!total || total === "*") throw new Error("Reaction count is unavailable.");

    // 최근 반응 시각: created_at 내림차순 1건.
    const latestQuery = new URLSearchParams({
      artwork_id: `eq.${artworkId}`,
      select: "created_at",
      order: "created_at.desc",
      limit: "1",
    });
    const latestResponse = await fetch(`${config.url}/rest/v1/reactions?${latestQuery}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
      },
    });
    if (!latestResponse.ok) throw new Error("Could not read latest reaction time.");
    const rows = await latestResponse.json();
    const latest = Array.isArray(rows) && rows.length ? rows[0].created_at : null;

    return [artworkId, { count: Number(total), latest }];
  }));
  return Object.fromEntries(entries);
}

export default async (request) => {
  if (request.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { Allow: "GET, POST, OPTIONS" }, body: "" };
  }
  if (request.httpMethod !== "GET" && request.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let config;
  try {
    config = getConfig();
    if (request.httpMethod === "GET") {
      return json(200, { stats: await readStats(config) });
    }

    let body;
    try {
      body = JSON.parse(request.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    const artworkId = body?.artworkId;
    if (typeof artworkId !== "string" || !ARTWORK_IDS.has(artworkId)) {
      return json(400, { error: "Unknown artwork." });
    }

    const saved = await fetch(`${config.url}/rest/v1/reactions`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ artwork_id: artworkId }),
    });
    if (!saved.ok) throw new Error("Could not save reaction.");
    try {
      return json(201, { saved: true, stats: await readStats(config) });
    } catch {
      // The insert succeeded; let the browser acknowledge it and retry the read.
      return json(201, { saved: true });
    }
  } catch {
    return json(500, { error: "Reaction service is unavailable." });
  }
};
