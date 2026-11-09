const ARTWORK_IDS = new Set([
  "photo-night",
  "animation-short",
  "poster",
  "kart3d",
]);

// 표준 Response(JSON) 생성. Netlify의 신형 ESM 함수는 Response 객체를 반환해야 한다.
function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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
    // 누적 횟수: count=exact 로 전체 행 수를 센다(행을 가져오지 않으므로 행 상한과 무관).
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

// Netlify 신형 ESM 함수: 표준 Request를 받아 표준 Response를 반환한다.
export default async (request) => {
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response("", { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
  }
  if (method !== "GET" && method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  // POST 입력 검사는 서버 설정(환경 변수)과 무관하게 먼저 수행한다.
  // 이렇게 하면 "입력 오류(400)"와 "서버 설정 실패(500)"가 섞이지 않는다.
  let artworkId;
  if (method === "POST") {
    // 본문을 문자열로 먼저 읽어 과도하게 큰 요청을 파싱 전에 거절한다.
    const raw = await request.text();
    if (raw.length > 1024) {
      return json(413, { error: "Request body is too large." });
    }
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    artworkId = body?.artworkId;
    // 빈 값·타입 오류·너무 긴 값·허용 외 값을 서버에서 모두 거절한다.
    if (typeof artworkId !== "string" || artworkId.length === 0 || artworkId.length > 64) {
      return json(400, { error: "Invalid artwork id." });
    }
    if (!ARTWORK_IDS.has(artworkId)) {
      return json(400, { error: "Unknown artwork." });
    }
  }

  let config;
  try {
    config = getConfig();
    if (method === "GET") {
      return json(200, { stats: await readStats(config) });
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
      // 저장은 성공했으니, 브라우저가 이를 받고 집계를 다시 읽게 한다.
      return json(201, { saved: true });
    }
  } catch {
    return json(500, { error: "Reaction service is unavailable." });
  }
};
