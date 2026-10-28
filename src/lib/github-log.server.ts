import { readFileSync } from "node:fs";
import { LOG_FILE_HREF, MAX_TEXT, type PublicLog, type PublicMessage } from "@/lib/log-public";

/**
 * Server-only writer for the public GitHub log.
 * Do not import this module from client components. The credential never
 * leaves the server, and this app exposes no delete or edit operation.
 * The credential is read from GITHUB_TOKEN or a local file that is never committed.
 */
const LOCAL_TOKEN_PATH = "/workspace/.secrets/github-token";

const API = "https://api.github.com";
const REPO = "Vraigos/LogEndpoint";
const FILE_PATH = "issus.json";
const BRANCH = "main";
const MAX_MESSAGES = 5000;
const MAX_BYTES = 900_000;
const PER_IP_LIMIT = 15;
const GLOBAL_LIMIT = 40;
const WINDOW_MS = 60_000;

export class LogError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LogError";
    this.status = status;
  }
}

type RemoteFile = {
  doc: Record<string, unknown>;
  sha?: string;
};

const hitsByIp = new Map<string, number[]>();
let globalHits: number[] = [];
let writeQueue: Promise<unknown> = Promise.resolve();

function readLocalToken(): string {
  try {
    return readFileSync(LOCAL_TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

function credential(): string {
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readLocalToken();
  if (fromFile) return fromFile;
  throw new LogError(502, "GitHub credential is not configured on the server.");
}

export function publicErrorMessage(err: unknown): string {
  const raw = err instanceof LogError || err instanceof Error ? err.message : "The log could not be reached.";
  const secret = process.env.GITHUB_TOKEN?.trim() || readLocalToken();
  const cleaned = secret ? raw.split(secret).join("credentials") : raw;
  return cleaned.slice(0, 280);
}

export function normalizeMessage(input: string): string {
  if (typeof input !== "string") {
    throw new LogError(400, "Send the message as raw text.");
  }
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new LogError(400, "Write a message before sealing it.");
  if (text.length > MAX_TEXT) {
    throw new LogError(400, `Keep the message under ${MAX_TEXT} characters.`);
  }
  return text;
}

function prune(stamps: number[], now: number): number[] {
  return stamps.filter((stamp) => now - stamp < WINDOW_MS);
}

function assertRate(ip: string): void {
  const now = Date.now();
  const key = ip.slice(0, 80) || "unknown";
  const mine = prune(hitsByIp.get(key) ?? [], now);
  globalHits = prune(globalHits, now);
  if (mine.length >= PER_IP_LIMIT || globalHits.length >= GLOBAL_LIMIT) {
    hitsByIp.set(key, mine);
    throw new LogError(429, "Too many messages. Wait a minute and try again.");
  }
  mine.push(now);
  globalHits.push(now);
  hitsByIp.set(key, mine);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] ?? 0);
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function gh(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${credential()}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "issue-drop");
  try {
    return await fetch(`${API}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new LogError(502, "Could not reach GitHub.");
  }
}

async function failFromGithub(res: Response): Promise<never> {
  let detail = "";
  try {
    const data = (await res.json()) as { message?: string };
    if (typeof data.message === "string") detail = data.message;
  } catch {
    detail = "";
  }
  if (res.status === 401) {
    throw new LogError(502, "GitHub rejected the saved credentials. Revoke that token and issue a new one.");
  }
  if (detail.toLowerCase().includes("rate limit")) {
    throw new LogError(429, "GitHub is rate-limiting writes. Try again shortly.");
  }
  throw new LogError(502, "GitHub refused to update the log file.");
}

async function fetchFile(): Promise<RemoteFile> {
  const res = await gh(`/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`);
  if (res.status === 404) return { doc: {} };
  if (!res.ok) return failFromGithub(res);
  const data = (await res.json()) as { content?: string; sha?: string; encoding?: string };
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new LogError(502, "The log file came back in an unexpected format.");
  }
  const text = fromBase64(data.content);
  let parsed: unknown;
  try {
    parsed = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new LogError(409, "issus.json is not valid JSON, so nothing was written.");
  }
  if (Array.isArray(parsed)) return { doc: { messages: parsed }, sha: data.sha };
  if (!parsed || typeof parsed !== "object") return { doc: {}, sha: data.sha };
  return { doc: parsed as Record<string, unknown>, sha: data.sha };
}

function toPublic(item: unknown): PublicMessage | null {
  if (typeof item === "string") {
    if (!item.trim()) return null;
    return { text: item, at: null };
  }
  if (!item || typeof item !== "object") return null;
  const rec = item as Record<string, unknown>;
  if (typeof rec.text !== "string" || !rec.text.trim()) return null;
  return { text: rec.text, at: typeof rec.at === "string" ? rec.at : null };
}

function messageList(doc: Record<string, unknown>): unknown[] {
  if (!("messages" in doc) || doc.messages == null) return [];
  if (!Array.isArray(doc.messages)) {
    throw new LogError(409, 'issus.json already uses "messages" for something else, so nothing was written.');
  }
  return [...doc.messages];
}

export async function readLog(): Promise<PublicLog> {
  const remote = await fetchFile();
  const messages = messageList(remote.doc).map(toPublic).filter((item): item is PublicMessage => item !== null);
  return { messages, count: messages.length, href: LOG_FILE_HREF, error: null };
}

async function appendOnce(text: string): Promise<{ text: string; at: string; count: number }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await fetchFile();
    const messages = messageList(remote.doc);
    if (messages.length >= MAX_MESSAGES) {
      throw new LogError(413, "The log is full. Remove entries on GitHub to continue.");
    }
    const at = new Date().toISOString();
    messages.push({ text, at });
    const doc = { ...remote.doc, messages };
    const serialized = `${JSON.stringify(doc, null, 2)}\n`;
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) {
      throw new LogError(413, "The log file is too large to add another line.");
    }
    const preview = text.replace(/\s+/g, " ").slice(0, 72);
    const payload: Record<string, string> = {
      message: `Append log entry: ${preview}`,
      content: toBase64(serialized),
      branch: BRANCH,
    };
    if (remote.sha) payload.sha = remote.sha;
    const res = await gh(`/repos/${REPO}/contents/${FILE_PATH}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 409 || res.status === 422) continue;
    if (!res.ok) return failFromGithub(res);
    return { text, at, count: messages.length };
  }
  throw new LogError(409, "The log was busy. Try again.");
}

export function appendMessage(text: string, ip = "unknown"): Promise<{ text: string; at: string; count: number }> {
  const clean = normalizeMessage(text);
  assertRate(ip);
  return enqueue(() => appendOnce(clean));
}
