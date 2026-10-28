import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { Check, Copy, LockKeyhole, RefreshCw, Send } from "lucide-react";
import { loadLog } from "@/lib/log.functions";
import { LOG_REPO_LABEL, MAX_TEXT, type PublicLog, type PublicMessage } from "@/lib/log-public";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export const Route = createFileRoute("/")({
  loader: () => loadLog(),
  component: Home,
});

function endpointPath(): string {
  if (typeof window === "undefined") return "/api/github";
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}/api/json`;
}

function formatWhen(at: string | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "d MMM yyyy · HH:mm");
}

function Home() {
  const loaded = Route.useLoaderData();
  const router = useRouter();
  const [log, setLog] = useState<PublicLog>(loaded);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [fault, setFault] = useState<string | null>(loaded.error);
  const [copied, setCopied] = useState(false);
  const [endpoint, setEndpoint] = useState("/api/json");

  useEffect(() => {
    setLog(loaded);
    setFault(loaded.error);
  }, [loaded]);

  useEffect(() => {
    const path = endpointPath();
    setEndpoint(`${window.location.origin}${path}`);
  }, []);

  const sealed = draft.trim();
  const tooLong = sealed.length > MAX_TEXT;
  const newestFirst = log.messages.map((message, index) => ({ ...message, n: index + 1 })).reverse();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sealed || tooLong || pending) return;
    setPending(true);
    setNotice(null);
    setFault(null);
    try {
      const res = await fetch(endpointPath(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sealed }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        text?: string;
        at?: string;
      } | null;
      if (!res.ok || !data?.ok || typeof data.text !== "string") {
        throw new Error(data?.error || "Could not seal that message.");
      }
      const entry: PublicMessage = { text: data.text, at: data.at ?? null };
      setLog((current) => ({
        ...current,
        error: null,
        count: current.count + 1,
        messages: [...current.messages, entry],
      }));
      setDraft("");
      setNotice("Sealed. It is in the GitHub file now, and this app cannot take it back.");
    } catch (err) {
      setFault(err instanceof Error ? err.message : "Could not seal that message.");
    } finally {
      setPending(false);
    }
  }

  async function refresh() {
    setFault(null);
    await router.invalidate();
  }

  async function copySample() {
    const sample = `POST ${endpoint}\nContent-Type: application/json\n\n{"text":"hello"}`;
    try {
      await navigator.clipboard.writeText(sample);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setFault("Could not copy the request. Select it from the sample instead.");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-8 pb-16 sm:pt-14">
      <header>
        <p className="text-xs font-medium tracking-widest text-accent uppercase">Append only</p>
        <h1 className="mt-3 text-4xl leading-none text-fg sm:text-5xl">Issue Drop</h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Type anything. It is written, as raw text, into {LOG_REPO_LABEL}. Nothing on this page can delete it.
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted">
          <LockKeyhole className="size-4 text-accent" aria-hidden="true" />
          Removal only happens in the GitHub account.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mt-8 rounded-3xl bg-surface p-2 shadow-hairline">
        <label htmlFor="message" className="block px-3 pt-3 text-sm font-medium text-muted">
          Raw message
        </label>
        <textarea
          id="message"
          name="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="hello"
          rows={4}
          maxLength={MAX_TEXT + 200}
          autoComplete="off"
          className="mt-2 min-h-32 w-full resize-y rounded-2xl bg-bg px-4 py-3 text-base text-fg outline-none placeholder:text-muted focus-visible:shadow-lift"
        />
        <div className="flex items-center justify-between gap-3 px-2 py-2">
          <p className="text-sm text-muted tabular-nums">
            {tooLong ? "Too long to seal." : `${sealed.length} / ${MAX_TEXT}`}
          </p>
          <button
            type="submit"
            disabled={!sealed || tooLong || pending}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-base font-medium text-bg transition-transform duration-150 ease-out active:not-disabled:scale-[0.96] disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {pending ? "Sealing…" : "Seal it"}
          </button>
        </div>
      </form>

      {notice ? (
        <p role="status" className="mt-4 text-sm text-accent">
          {notice}
        </p>
      ) : null}
      {fault ? (
        <p role="alert" className="mt-4 text-sm text-fg">
          {fault}
        </p>
      ) : null}

      <section className="mt-10" aria-labelledby="log-heading">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="log-heading" className="text-2xl text-fg">
              Sealed lines
            </h2>
            <p className="mt-1 text-sm text-muted tabular-nums">
              {log.count} {log.count === 1 ? "entry" : "entries"} · oldest stays
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm font-medium text-muted transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Refresh
          </button>
        </div>

        {newestFirst.length === 0 ? (
          <p className="mt-6 rounded-3xl bg-surface px-5 py-8 text-base text-muted shadow-hairline">
            Nothing sealed yet. The first line stays until someone edits the file on GitHub.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-fg/10">
            {newestFirst.map((message) => (
              <li key={`${message.at ?? "note"}-${message.n}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 py-4">
                <span className="pt-0.5 text-sm text-accent tabular-nums">#{String(message.n).padStart(3, "0")}</span>
                <div className="min-w-0">
                  <p className="text-base break-words whitespace-pre-wrap text-fg">{message.text}</p>
                  {formatWhen(message.at) ? (
                    <p className="mt-1 text-sm text-muted tabular-nums">{formatWhen(message.at)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-10 rounded-3xl bg-surface p-2 shadow-hairline" aria-labelledby="endpoint-heading">
        <div className="flex items-start justify-between gap-3 px-3 pt-3">
          <div>
            <h2 id="endpoint-heading" className="text-2xl text-fg">
              JSON for another app
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              POST <span className="text-fg">{"{\"text\":\"hello\"}"}</span>. GET reads the log. Delete is refused.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copySample()}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-bg px-3 text-sm font-medium text-fg shadow-hairline transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            {copied ? <Check className="size-4 text-accent" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-4 px-3 text-sm break-all text-accent">{endpoint}</p>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-bg p-4 font-mono text-sm leading-relaxed text-fg">{`POST /api/json
Content-Type: application/json

{"text":"hello"}`}</pre>
        <p className="px-3 pt-3 pb-3 text-sm text-muted">
          The file itself is public:{" "}
          <a className="text-fg underline decoration-fg/30 underline-offset-4" href={log.href} target="_blank" rel="noreferrer">
            issus.json
          </a>
        </p>
      </section>
    </main>
  );
}
