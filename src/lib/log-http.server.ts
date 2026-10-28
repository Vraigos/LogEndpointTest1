import { LOG_FILE_HREF } from "@/lib/log-public";
import { LogError, appendMessage, publicErrorMessage, readLog } from "@/lib/github-log.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(CORS);
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return Response.json(body, { status, headers });
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.slice(0, 80);
  return request.headers.get("x-real-ip")?.slice(0, 80) || "unknown";
}

function textFromJson(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const rec = body as Record<string, unknown>;
    if (typeof rec.text === "string") return rec.text;
    if (typeof rec.message === "string") return rec.message;
  }
  throw new LogError(400, 'JSON needs a text field, for example {"text":"hello"}.');
}

export async function readJsonMessage(request: Request): Promise<string> {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new LogError(400, 'That JSON could not be read. Use {"text":"hello"}.');
  }
  return textFromJson(body);
}

async function messageFromRequest(request: Request): Promise<string> {
  const queryText = new URL(request.url).searchParams.get("text");
  const type = (request.headers.get("content-type") || "").toLowerCase();
  let fromBody = "";

  if (type.includes("json") || type === "") {
    const raw = await request.clone().text();
    const trimmed = raw.trim();
    if (type.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return readJsonMessage(request);
    }
  }

  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData();
    const value = form.get("text") ?? form.get("message");
    if (typeof value !== "string") throw new LogError(400, 'Send a form field named "text".');
    fromBody = value;
  } else if (!type.includes("json")) {
    fromBody = await request.text();
  }

  if (fromBody.trim()) return fromBody;
  if (queryText?.trim()) return queryText;
  return fromBody;
}

function fail(err: unknown, fallback: number) {
  const status = err instanceof LogError ? err.status : fallback;
  return json({ ok: false, error: publicErrorMessage(err) }, status);
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export function handleLocked() {
  return json(
    {
      ok: false,
      error: "Messages cannot be removed here. Only the GitHub account can edit issus.json.",
    },
    405,
    { Allow: "GET, POST, OPTIONS" },
  );
}

export async function handleGet() {
  try {
    const log = await readLog();
    return json({ ok: true, count: log.count, messages: log.messages, file: log.href });
  } catch (err) {
    return fail(err, 502);
  }
}

async function save(text: string, request: Request) {
  const saved = await appendMessage(text, clientIp(request));
  return json({ ok: true, text: saved.text, at: saved.at, count: saved.count, file: LOG_FILE_HREF }, 201);
}

export async function handlePost(request: Request) {
  try {
    return await save(await messageFromRequest(request), request);
  } catch (err) {
    return fail(err, 500);
  }
}

export async function handlePostJson(request: Request) {
  try {
    const type = (request.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("json") && !type.includes("text/plain")) {
      throw new LogError(415, 'Send Content-Type: application/json and a body like {"text":"hello"}.');
    }
    return await save(await readJsonMessage(request), request);
  } catch (err) {
    return fail(err, 500);
  }
}
