// 방명록 함수 (Netlify 신형 ESM): 표준 Request를 받아 표준 Response를 반환한다.
// GET  → 최근 글 목록 조회
// POST → 별명/메시지 등록 (서버에서 길이·타입 검사)
// 수정·삭제 API는 제공하지 않는다.

const NICK_MIN = 2, NICK_MAX = 12;
const MSG_MIN = 1, MSG_MAX = 100;
const LIST_LIMIT = 50; // 최근 글 최대 노출 수

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

// 최근 글을 created_at 내림차순으로 조회한다(최대 LIST_LIMIT건).
async function readEntries(config) {
  const query = new URLSearchParams({
    select: "id,nickname,message,created_at",
    order: "created_at.desc",
    limit: String(LIST_LIMIT),
  });
  const response = await fetch(`${config.url}/rest/v1/guestbook_entries?${query}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error("Could not read guestbook.");
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export default async (request) => {
  const method = request.method;

  if (method === "OPTIONS") {
    return new Response("", { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
  }
  if (method !== "GET" && method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  // 입력 검사는 서버 설정(환경 변수)과 무관하게 먼저 수행한다.
  let nickname, message;
  if (method === "POST") {
    const raw = await request.text();
    if (raw.length > 2048) {
      return json(413, { error: "Request body is too large." });
    }
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    nickname = typeof body?.nickname === "string" ? body.nickname.trim() : null;
    message = typeof body?.message === "string" ? body.message.trim() : null;

    if (nickname === null || message === null) {
      return json(400, { error: "별명과 메시지를 모두 입력해 주세요." });
    }
    if (nickname.length < NICK_MIN || nickname.length > NICK_MAX) {
      return json(400, { error: `별명은 ${NICK_MIN}~${NICK_MAX}자여야 합니다.` });
    }
    if (message.length < MSG_MIN || message.length > MSG_MAX) {
      return json(400, { error: `메시지는 ${MSG_MIN}~${MSG_MAX}자여야 합니다.` });
    }
  }

  let config;
  try {
    config = getConfig();
    if (method === "GET") {
      return json(200, { entries: await readEntries(config) });
    }

    const saved = await fetch(`${config.url}/rest/v1/guestbook_entries`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ nickname, message }),
    });
    if (!saved.ok) throw new Error("Could not save guestbook entry.");
    try {
      return json(201, { saved: true, entries: await readEntries(config) });
    } catch {
      return json(201, { saved: true });
    }
  } catch {
    return json(500, { error: "Guestbook service is unavailable." });
  }
};
