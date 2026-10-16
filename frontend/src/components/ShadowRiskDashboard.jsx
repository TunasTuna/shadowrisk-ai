import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SettingsPanel from "./SettingsPanel.jsx";
import { applyTheme } from "../lib/theme.js";
import {
  KEYS,
  DEFAULT_SETTINGS,
  clearAll,
  load,
  loadSettings,
  save,
} from "../lib/storage.js";

const MAX_LOG_LINES = 240;

const TAG_COLORS = {
  SYS: "text-[#10B981]",
  SYS_OK: "text-[#34D399]",
  AUDIT: "text-sky-400",
  NET: "text-gray-600",
  WARN: "text-amber-400",
  ERR: "text-red-400",
};

const EMPTY_SOURCES = {
  lastAuditAt: null,
  bootedAt: new Date().toISOString(),
};

function stamp(date = new Date()) {
  return date.toTimeString().slice(0, 8);
}

function fmtClock(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

function fmtUptime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}h ` : ""}${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function ShadowRiskDashboard() {
  const boot = useMemo(() => {
    const settings = loadSettings();
    const session = settings.restoreSession ? load(KEYS.session, null) : null;
    const sources = load(KEYS.sources, null);
    return { settings, session, sources };
  }, []);

  const restoredLogs =
    boot.settings.restoreSession && Array.isArray(boot.session?.logs)
      ? boot.session.logs.map((line, index) => ({
        id: index,
        time: line.time,
        tag: line.tag,
        msg: line.msg,
      }))
      : [];

  const restoredReady = boot.session?.status === "ready" && boot.session?.markdown;

  const [settings, setSettings] = useState(boot.settings);
  const [query, setQuery] = useState(boot.session?.entity || boot.settings.defaultTicker || "");
  const [entity, setEntity] = useState(boot.session?.entity || "");
  const [markdown, setMarkdown] = useState(boot.session?.markdown || "");
  const [status, setStatus] = useState(restoredReady ? "ready" : "idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sources, setSources] = useState(() => ({ ...EMPTY_SOURCES, ...(boot.sources || {}) }));
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [logs, setLogs] = useState(restoredLogs);

  const idRef = useRef(restoredLogs.length);
  const consoleRef = useRef(null);
  const paperRef = useRef(null);
  const bootedRef = useRef(false);

  const pushLog = useCallback((tag, msg) => {
    setLogs((prev) => {
      const next = [...prev, { id: idRef.current++, time: stamp(), tag, msg }];
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);

  /* ------------------------------- Persistence ------------------------------ */

  useLayoutEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    save(KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    save(KEYS.session, {
      entity,
      markdown,
      status: status === "running" ? "idle" : status,
      logs,
    });
  }, [entity, markdown, status, logs]);

  useEffect(() => {
    save(KEYS.sources, sources);
  }, [sources]);

  /* -------------------------------- Boot pass ------------------------------- */

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    if (restoredLogs.length > 0) {
      pushLog("SYS_OK", `SESSION_RESTORED: ${restoredLogs.length} EVT`);
    }
    if (restoredReady) {
      pushLog("SYS", `PAPER_RESTORED: ${boot.session.entity}`);
    }
    pushLog("SYS", "TERMINAL_READY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ Connectivity ------------------------------ */

  useEffect(() => {
    const up = () => {
      setOnline(true);
      pushLog("NET", "CONNECTIVITY_RESTORED: ONLINE");
    };
    const down = () => {
      setOnline(false);
      pushLog("WARN", "CONNECTIVITY_LOST: OFFLINE");
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [pushLog]);

  /* -------------------------------- Viewport -------------------------------- */

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (paperRef.current) paperRef.current.scrollTop = 0;
  }, [markdown]);

  /* --------------------------------- Actions -------------------------------- */

  const runAnalysis = async (event) => {
    event?.preventDefault();
    const target = query.trim().toUpperCase();
    if (!target || status === "running") return;

    const base = String(settings.apiBase || "").trim().replace(/\/+$/, "");
    const endpoint = `${base}/analyze`;

    setEntity(target);
    setMarkdown("");
    setStatus("running");
    pushLog("SYS", `QUERY_DISPATCH: ${target}`);
    pushLog("NET", `SEC_SCRAPE_INIT: ${target}`);
    pushLog("NET", `POST ${endpoint}`);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Bypass the ngrok free-tier browser warning interstitial
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ company: target }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();

      setMarkdown(data.report || data.markdown_report || data.markdown || "");
      if (typeof data.score === "number") {
        pushLog("AUDIT", `SHADOW_RISK_SCORE: ${data.score}`);
      }
      setStatus("ready");
      pushLog("SYS_OK", `RENDER_COMPLETE: ${target}`);
      setSources((prev) => ({ ...prev, lastAuditAt: new Date().toISOString() }));

    } catch (err) {
      setStatus("idle");
      pushLog("ERR", `CONNECTION_REFUSED: ${err.message}`);
    }
  };

  const handleExport = () => {
    if (status !== "ready") return;
    window.print();
  };

  const handleSettingsChange = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  const handleOpenSettings = () => setSettingsOpen(true);

  const handleClearData = () => {
    clearAll();
    setLogs([]);
    idRef.current = 0;
    setQuery("");
    setEntity("");
    setMarkdown("");
    setStatus("idle");
    setSources({ ...EMPTY_SOURCES, bootedAt: new Date().toISOString() });
    setSettings({ ...DEFAULT_SETTINGS, theme: settings.theme });
    pushLog("WARN", "SESSION_DATA_CLEARED");
  };

  const statusLabel = {
    idle: "AWAITING TARGET",
    running: "COMPILING",
    ready: "RENDERED",
  }[status];

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-none bg-[#0B0F19] font-mono text-gray-200 print:h-auto print:overflow-visible">
      {/* -------------------------------- HEADER -------------------------------- */}
      <header className="flex h-11 shrink-0 items-center justify-between rounded-none border-b border-gray-800 px-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="grid h-7 w-7 place-items-center rounded-none border border-[#10B981]/40 bg-[#10B981]/10">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-[#34D399]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <span
            className="h-2 w-2 shrink-0 animate-pulse bg-[#10B981]"
            aria-hidden="true"
          />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-white">
            SHADOW<span className="text-[#34D399]">RISK</span>
          </span>
          <span className="rounded-none border border-gray-800 px-1.5 py-[2px] text-[10px] uppercase tracking-[0.2em] text-gray-500">
            AI
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenSettings}
            className="flex items-center gap-1.5 rounded-none border border-gray-800 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500 transition-colors hover:border-gray-700 hover:text-gray-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z" />
            </svg>
            Settings
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={status !== "ready"}
            className="rounded-none border border-[#10B981] bg-[#10B981] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#0B0F19] transition-colors hover:bg-[#34D399] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981] disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-transparent disabled:text-gray-600"
          >
            Export PDF
          </button>
        </div>
      </header>

      {/* -------------------------------- BODY GRID ------------------------------- */}
      <main className="flex min-h-0 flex-1 print:block">
        {/* ------------------------------- LEFT 1/3 ------------------------------ */}
        <section className="flex w-1/3 min-w-0 shrink-0 flex-col rounded-none border-r border-gray-800 print:hidden">
          <div className="shrink-0 rounded-none border-b border-gray-800">
            <SectionHeader title="QUERY TERMINAL" meta="INPUT" />
            <form onSubmit={runAnalysis} className="flex flex-col gap-2 p-2">
              <label
                htmlFor="ticker"
                className="text-[10px] uppercase tracking-[0.18em] text-gray-500"
              >
                &gt; TICKER / ENTITY
              </label>
              <div className="flex items-center rounded-none border border-gray-800 bg-[#0B0F19] focus-within:border-[#10B981]">
                <span className="select-none pl-2 pr-1 text-sm text-[#10B981]">$</span>
                <input
                  id="ticker"
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Enter ticker or company name"
                  className="w-full rounded-none bg-transparent px-1 py-1.5 text-sm uppercase tracking-wide text-gray-200 placeholder:text-gray-600 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!query.trim() || status === "running"}
                className="w-full rounded-none border border-[#10B981] bg-[#10B981] py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#0B0F19] transition-colors hover:bg-[#34D399] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#10B981] disabled:cursor-not-allowed disabled:border-gray-800 disabled:bg-transparent disabled:text-gray-600"
              >
                {status === "running" ? "[ COMPILING... ]" : "[ RUN CREDIT ANALYSIS ]"}
              </button>
            </form>
          </div>

          <div className="flex min-h-0 flex-1 flex-col rounded-none">
            <SectionHeader title="LIVE FEED — AUDIT LOG" meta={`${logs.length} EVT`} />
            <div
              ref={consoleRef}
              className="min-h-0 flex-1 overflow-y-auto rounded-none bg-[#0B0F19] px-3 py-2 text-[11px] leading-[1.6]"
              role="log"
              aria-live="polite"
            >
              {logs.map((line) => (
                <div key={line.id} className="break-words">
                  <span className="text-gray-600">{line.time}</span>{" "}
                  <span className={TAG_COLORS[line.tag] || "text-gray-500"}>
                    [{line.tag}]
                  </span>{" "}
                  <span className="text-gray-200">{line.msg}</span>
                </div>
              ))}
              <div className="text-[#10B981]">
                &gt;{" "}
                <span
                  className="inline-block h-3 w-[7px] animate-pulse bg-[#10B981] align-middle"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------ RIGHT 2/3 ------------------------------ */}
        <section className="flex w-2/3 min-w-0 flex-col rounded-none print:block print:w-full">
          <SectionHeader title="CREDIT PAPER — PDF" meta={statusLabel} />
          <div ref={paperRef} className="print-static min-h-0 flex-1 overflow-y-auto rounded-none p-3">
            {status === "ready" && markdown ? (
              <article
                className="credit-paper prose prose-invert prose-sm max-w-none rounded-none font-sans
                  prose-headings:font-mono prose-headings:font-semibold prose-headings:tracking-wider prose-headings:text-white
                  prose-h1:mb-2 prose-h1:border-b prose-h1:border-gray-800 prose-h1:pb-2 prose-h1:text-[15px] prose-h1:uppercase
                  prose-h2:mb-2 prose-h2:mt-6 prose-h2:border-b prose-h2:border-gray-800 prose-h2:pb-1.5 prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.14em] prose-h2:text-[#10B981]
                  prose-h3:mb-1 prose-h3:mt-4 prose-h3:text-[11px] prose-h3:uppercase prose-h3:text-gray-200
                  prose-p:my-1.5 prose-p:text-[13px] prose-p:leading-relaxed prose-p:text-gray-200
                  prose-a:text-[#34D399] prose-a:no-underline hover:prose-a:underline
                  prose-strong:font-semibold prose-strong:text-white
                  prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[13px] prose-li:marker:text-[#10B981]
                  prose-blockquote:my-2 prose-blockquote:border-l-2 prose-blockquote:border-[#10B981] prose-blockquote:bg-[#10B981]/[0.04] prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-gray-500
                  prose-code:rounded-none prose-code:border prose-code:border-[#10B981]/20 prose-code:bg-[#10B981]/10 prose-code:px-1 prose-code:py-[1px] prose-code:font-mono prose-code:text-[11px] prose-code:font-normal prose-code:text-[#34D399] prose-code:before:content-[''] prose-code:after:content-['']
                  prose-table:my-3 prose-table:font-mono prose-table:text-[11px]
                  prose-thead:border-gray-800
                  prose-th:border prose-th:border-gray-800 prose-th:bg-white/[0.03] prose-th:px-2.5 prose-th:py-1.5 prose-th:text-[10px] prose-th:uppercase prose-th:tracking-wider prose-th:text-[#10B981]
                  prose-td:border prose-td:border-gray-800 prose-td:px-2.5 prose-td:py-1.5 prose-td:text-gray-200
                  prose-hr:my-4 prose-hr:border-gray-800"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
              </article>
            ) : status === "running" ? (
              <LoadingSkeleton />
            ) : (
              <BlankSheet />
            )}
          </div>
        </section>
      </main>

      {/* ------------------------------ STATUS BAR ------------------------------ */}
      {settings.statusBar && (
        <StatusBar
          online={online}
          lastAuditAt={sources.lastAuditAt}
          bootedAt={sources.bootedAt}
          theme={settings.theme}
        />
      )}

      {/* ------------------------------- SETTINGS ------------------------------- */}
      {settingsOpen && (
        <div className="fixed right-3 top-14 z-50 flex h-[460px] max-h-[calc(100vh-4.5rem)] w-[380px] flex-col rounded-none border border-gray-700 bg-[#0B0F19] print:hidden">
          <SectionHeader
            title="SETTINGS"
            meta="CONFIG"
            onClose={() => setSettingsOpen(false)}
          />
          <div className="min-h-0 flex-1 overflow-hidden rounded-none">
            <SettingsPanel
              settings={settings}
              onChange={handleSettingsChange}
              onClearData={handleClearData}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Sub-components ----------------------------- */

const TONE_CLASS = {
  ok: "text-[#10B981]",
  err: "text-red-400",
  brand: "text-[#10B981]",
  muted: "text-gray-500",
};

function SectionHeader({ title, meta, onClose }) {
  return (
    <div className="flex h-7 shrink-0 select-none items-center justify-between rounded-none border-b border-gray-800 px-2 text-[10px] uppercase tracking-[0.16em]">
      <span className="flex items-center gap-2">
        <span className="text-[#10B981]" aria-hidden="true">
          ▸
        </span>
        <span className="text-gray-200">{title}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-gray-500">{meta}</span>
        {onClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-4 w-4 place-items-center rounded-none text-gray-500 hover:text-red-400"
          >
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

function StatusBar({ online, lastAuditAt, bootedAt, theme }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const bootedAtMs = bootedAt ? new Date(bootedAt).getTime() : now;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-4 rounded-none border-t border-gray-800 bg-[#0B0F19] px-3 text-[10px] uppercase tracking-[0.14em] text-gray-600 print:hidden">
      <StatusItem label="CONN" value={online ? "ONLINE" : "OFFLINE"} tone={online ? "ok" : "err"} />
      <StatusItem label="LAST AUDIT" value={fmtClock(lastAuditAt)} tone="muted" />
      <StatusItem label="SESSION" value={fmtUptime(now - bootedAtMs)} tone="muted" />
      <StatusItem label="THEME" value={theme.toUpperCase()} tone="brand" />

      <div className="ml-auto flex items-center gap-4">
        <span className="text-gray-500">{fmtClock(now)}</span>
      </div>
    </footer>
  );
}

function StatusItem({ label, value, tone = "muted" }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-gray-600">{label}</span>
      <span className={TONE_CLASS[tone] || TONE_CLASS.muted}>{value}</span>
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2 rounded-none" aria-hidden="true">
      <div className="h-5 w-2/3 rounded-none bg-white/[0.05]" />
      <div className="h-2 w-1/3 rounded-none bg-white/[0.05]" />
      <div className="space-y-1.5 pt-3">
        <div className="h-2 w-full rounded-none bg-white/[0.05]" />
        <div className="h-2 w-11/12 rounded-none bg-white/[0.05]" />
        <div className="h-2 w-4/5 rounded-none bg-white/[0.05]" />
      </div>
      <div className="h-28 w-full rounded-none border border-gray-800 bg-white/[0.05]" />
      <div className="space-y-1.5 pt-2">
        <div className="h-2 w-full rounded-none bg-white/[0.05]" />
        <div className="h-2 w-3/4 rounded-none bg-white/[0.05]" />
      </div>
    </div>
  );
}

function BlankSheet() {
  return (
    <div
      className="h-full w-full rounded-none border border-gray-800"
      style={{
        backgroundColor: "rgba(255,255,255,0.01)",
        backgroundImage:
          "linear-gradient(to right, rgba(31,41,55,0.6) 1px, transparent 1px), linear-gradient(to bottom, rgba(31,41,55,0.6) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    />
  );
}
