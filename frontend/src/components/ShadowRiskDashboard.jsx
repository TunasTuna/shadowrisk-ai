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
import { runBootChecks } from "../lib/bootChecks.js";
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
// 1. ADDED RECHARTS IMPORT
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const MAX_LOG_LINES = 240;
const HEADER_H = 44;
const STATUS_H = 26;
const PAD = 12;

const TAG_COLORS = {
  SYS: "text-[#10B981]",
  SYS_OK: "text-emerald-400",
  AUDIT: "text-sky-400",
  NET: "text-gray-500",
  WARN: "text-amber-400",
  ERR: "text-red-400",
};

const EMPTY_SOURCES = {
  edgarOk: null,
  edgarAt: null,
  lastAuditAt: null,
  bootedAt: new Date().toISOString(),
  version: null,
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

function computeLayout() {
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const canvasH = Math.max(460, vh - HEADER_H - STATUS_H);
  const leftW = Math.max(300, Math.min(460, Math.round(vw * 0.28)));
  const tickerH = 200;

  return {
    ticker: { x: PAD, y: PAD, w: leftW, h: tickerH, z: 3 },
    log: {
      x: PAD,
      y: PAD + tickerH + PAD,
      w: leftW,
      h: Math.max(220, canvasH - tickerH - PAD * 3),
      z: 2,
    },
    report: {
      x: PAD + leftW + PAD,
      y: PAD,
      w: Math.max(360, vw - leftW - PAD * 3),
      h: Math.max(320, canvasH - PAD * 2),
      z: 1,
    },
    settings: {
      x: Math.max(PAD, Math.round((vw - 380) / 2)),
      y: 56,
      w: 380,
      h: Math.min(460, Math.max(300, canvasH - 120)),
      z: 6,
    },
  };
}

function mergeLayout(stored) {
  const base = computeLayout();
  if (!stored || typeof stored !== "object") return base;
  Object.keys(base).forEach((id) => {
    const s = stored[id];
    if (!s || typeof s !== "object") return;
    base[id] = {
      x: Number.isFinite(s.x) ? s.x : base[id].x,
      y: Number.isFinite(s.y) ? s.y : base[id].y,
      w: Number.isFinite(s.w) ? s.w : base[id].w,
      h: Number.isFinite(s.h) ? s.h : base[id].h,
      z: Number.isFinite(s.z) ? s.z : base[id].z,
    };
  });
  return base;
}

export default function ShadowRiskDashboard() {
  const boot = useMemo(() => {
    const settings = loadSettings();
    const session = settings.restoreSession ? load(KEYS.session, null) : null;
    const layout = load(KEYS.layout, null);
    const sources = load(KEYS.sources, null);
    return { settings, session, layout, sources };
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
  const [windows, setWindows] = useState(() => mergeLayout(boot.layout));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sources, setSources] = useState(() => ({ ...EMPTY_SOURCES, ...(boot.sources || {}) }));
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [logs, setLogs] = useState(restoredLogs);
  
  // 2. ADDED BREAKDOWN STATE
  const [breakdown, setBreakdown] = useState([]);

  const idRef = useRef(restoredLogs.length);
  const consoleRef = useRef(null);
  const paperRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const windowsRef = useRef(windows);
  const bootedRef = useRef(false);

  const pushLog = useCallback((tag, msg) => {
    setLogs((prev) => {
      const next = [...prev, { id: idRef.current++, time: stamp(), tag, msg }];
      return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
    });
  }, []);

  const applyWindows = useCallback((next) => {
    windowsRef.current = next;
    setWindows(next);
  }, []);

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

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    if (restoredLogs.length > 0) {
      pushLog("SYS_OK", `SESSION_RESTORED: ${restoredLogs.length} EVT`);
    }
    if (restoredReady) {
      pushLog("SYS", `PAPER_RESTORED: ${boot.session.entity}`);
    }
    if (settings.bootHealth) {
      runBootChecks(pushLog).then((meta) => {
        if (meta) setSources((prev) => ({ ...prev, ...meta }));
      });
    } else {
      pushLog("SYS", "BOOT_HEALTH: DISABLED");
    }
  }, []);

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

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (paperRef.current) paperRef.current.scrollTop = 0;
  }, [markdown]);

  const bringToFront = useCallback(
    (id) => {
      const prev = windowsRef.current;
      if (!prev[id]) return;
      const maxZ = Math.max(...Object.values(prev).map((w) => w.z));
      if (prev[id].z === maxZ) return;
      applyWindows({ ...prev, [id]: { ...prev[id], z: maxZ + 1 } });
    },
    [applyWindows]
  );

  const handlePointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const prev = windowsRef.current;
      const win = prev[drag.id];

      if (drag.mode === "move") {
        const x = Math.min(Math.max(drag.origX + dx, -drag.origW + 140), drag.maxX - 140);
        const y = Math.min(Math.max(drag.origY + dy, 0), drag.maxY - 30);
        applyWindows({ ...prev, [drag.id]: { ...win, x, y } });
        return;
      }
      const w = Math.max(260, Math.min(drag.origW + dx, drag.maxX - drag.origX));
      const h = Math.max(120, Math.min(drag.origH + dy, drag.maxY - drag.origY));
      applyWindows({ ...prev, [drag.id]: { ...win, w, h } });
    },
    [applyWindows]
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    save(KEYS.layout, windowsRef.current);
  }, [handlePointerMove]);

  const startInteraction = (id, mode) => (event) => {
    event.preventDefault();
    bringToFront(id);
    const win = windowsRef.current[id];
    const bounds = canvasRef.current?.getBoundingClientRect();
    dragRef.current = {
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origX: win.x,
      origY: win.y,
      origW: win.w,
      origH: win.h,
      maxX: bounds?.width ?? 2000,
      maxY: bounds?.height ?? 1200,
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  // 3. REPLACED MOCK WITH REAL BACKEND FETCH
  const runAnalysis = async (event) => {
    event?.preventDefault();
    const target = query.trim().toUpperCase();
    if (!target || status === "running") return;

    setEntity(target);
    setMarkdown("");
    setBreakdown([]); // Clear previous chart data
    setStatus("running");
    pushLog("SYS", `QUERY_DISPATCH: ${target}`);
    pushLog("NET", `SEC_SCRAPE_INIT: ${target}`);

    try {
      // Point this to your local backend (or ngrok URL if testing remotely)
      const response = await fetch('http://127.0.0.1:8000/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: target })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      setMarkdown(data.report); 
      setBreakdown(data.breakdown || []); // Capture the chart data
      setStatus("ready");
      pushLog("SYS_OK", `RENDER_COMPLETE: ${target} (Score: ${data.score}/100)`);
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

  const handleOpenSettings = () => {
    setSettingsOpen(true);
    bringToFront("settings");
  };

  const handleClearData = () => {
    clearAll();
    const base = computeLayout();
    applyWindows(base);
    setLogs([]);
    idRef.current = 0;
    setQuery("");
    setEntity("");
    setMarkdown("");
    setBreakdown([]);
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
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0F19] font-mono text-gray-200 print:h-auto print:overflow-visible">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-gray-800 px-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="grid h-7 w-7 place-items-center border border-[#10B981]/40 bg-[#10B981]/10 rounded-none">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#10B981]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <span className="h-2 w-2 shrink-0 animate-pulse bg-[#10B981]" aria-hidden="true" />
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-white">
            SHADOW<span className="text-[#10B981]">RISK</span>
          </span>
          <span className="border border-gray-700 px-1.5 py-[2px] text-[10px] uppercase tracking-[0.2em] text-gray-500 rounded-none">
            AI
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenSettings}
            className="rounded-none border border-gray-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 focus:outline-none"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={status !== "ready"}
            className="rounded-none border border-[#10B981] bg-[#10B981] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#0B0F19] transition-colors hover:bg-emerald-400 focus:outline-none disabled:border-gray-700 disabled:bg-transparent disabled:text-gray-600"
          >
            Export PDF
          </button>
        </div>
      </header>

      <div
        ref={canvasRef}
        className="term-canvas relative min-h-0 flex-1 overflow-hidden print:static print:overflow-visible"
      >
        <FloatingWindow
          win={windows.ticker}
          title="QUERY TERMINAL"
          meta="INPUT"
          onFocus={() => bringToFront("ticker")}
          onDragStart={startInteraction("ticker", "move")}
          onResizeStart={startInteraction("ticker", "resize")}
          className="print:hidden"
        >
          <form onSubmit={runAnalysis} className="flex h-full flex-col gap-2 p-2">
            <label htmlFor="ticker" className="text-[10px] uppercase tracking-[0.18em] text-gray-500">
              &gt; TICKER / ENTITY
            </label>
            <div className="flex items-center border border-gray-700 bg-[#0f1420] focus-within:border-[#10B981] rounded-none">
              <span className="select-none px-2 text-[#10B981]">$</span>
              <input
                id="ticker"
                type="text"
                autoComplete="off"
                spellCheck="false"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Enter ticker or company name"
                className="w-full bg-transparent px-1 py-1.5 text-sm uppercase tracking-wide text-gray-200 placeholder-gray-600 focus:outline-none rounded-none"
              />
            </div>
            <button
              type="submit"
              disabled={!query.trim() || status === "running"}
              className="w-full rounded-none border border-[#10B981] bg-[#10B981] py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-[#0B0F19] transition-colors hover:bg-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-transparent disabled:text-gray-600"
            >
              {status === "running" ? "[ COMPILING... ]" : "[ RUN CREDIT ANALYSIS ]"}
            </button>
          </form>
        </FloatingWindow>

        <FloatingWindow
          win={windows.log}
          title="LIVE FEED — AUDIT LOG"
          meta={`${logs.length} EVT`}
          onFocus={() => bringToFront("log")}
          onDragStart={startInteraction("log", "move")}
          onResizeStart={startInteraction("log", "resize")}
          className="print:hidden"
        >
          <div
            ref={consoleRef}
            className="h-full overflow-y-auto bg-[#0f1420] px-3 py-2 text-[11px] leading-[1.6]"
            role="log"
            aria-live="polite"
          >
            {logs.map((line) => (
              <div key={line.id} className="break-words">
                <span className="text-gray-600">{line.time}</span>{" "}
                <span className={TAG_COLORS[line.tag] || "text-gray-500"}>
                  [{line.tag}]
                </span>{" "}
                <span className="text-gray-400">{line.msg}</span>
              </div>
            ))}
            <div className="text-[#10B981]">
              &gt;{" "}
              <span
                className="inline-block h-3 w-[7px] animate-pulse bg-emerald-400 align-middle"
                aria-hidden="true"
              />
            </div>
          </div>
        </FloatingWindow>

        <FloatingWindow
          win={windows.report}
          title="CREDIT PAPER — PDF"
          meta={statusLabel}
          onFocus={() => bringToFront("report")}
          onDragStart={startInteraction("report", "move")}
          onResizeStart={startInteraction("report", "resize")}
          className="print-window print:block"
        >
          <div ref={paperRef} className="print-static h-full overflow-y-auto p-3">
            {status === "ready" && markdown ? (
              <>
                {/* 4. ADDED THE SICK RAINBOW CHART HERE */}
                {breakdown && breakdown.length > 0 && (
                  <div className="mb-4 border border-gray-800 bg-[#0f1420] p-3 rounded-none">
                    <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#10B981]">
                      &gt; RISK PILLAR EXPOSURE
                    </h3>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={breakdown} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                        <XAxis 
                          dataKey="pillar" 
                          tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} 
                          axisLine={{ stroke: '#374151' }} 
                          tickLine={false} 
                        />
                        <YAxis 
                          domain={[0, 100]} 
                          tick={{ fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' }} 
                          axisLine={{ stroke: '#374151' }} 
                          tickLine={false} 
                        />
                        <Tooltip 
                          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                          contentStyle={{ 
                            backgroundColor: '#0B0F19', 
                            border: '1px solid #374151', 
                            borderRadius: 0, 
                            fontFamily: 'monospace', 
                            fontSize: 11,
                            color: '#e5e7eb'
                          }}
                          itemStyle={{ color: '#10B981' }}
                          formatter={(value) => [`${value}/100 Risk`, 'Score']}
                        />
                        <Bar dataKey="score" radius={[0, 0, 0, 0]} barSize={32}>
                          {breakdown.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <article
                  className="credit-paper prose prose-invert prose-sm max-w-none font-sans
                    prose-headings:font-mono prose-headings:font-semibold prose-headings:tracking-wider prose-headings:text-white
                    prose-h1:mb-2 prose-h1:border-b prose-h1:border-gray-800 prose-h1:pb-2 prose-h1:text-[15px] prose-h1:uppercase
                    prose-h2:mb-2 prose-h2:mt-6 prose-h2:border-b prose-h2:border-gray-800 prose-h2:pb-1.5 prose-h2:text-[11px] prose-h2:uppercase prose-h2:tracking-[0.14em] prose-h2:text-emerald-400
                    prose-h3:mb-1 prose-h3:mt-4 prose-h3:text-[11px] prose-h3:uppercase prose-h3:text-gray-300
                    prose-p:my-1.5 prose-p:text-[13px] prose-p:leading-relaxed prose-p:text-gray-300
                    prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
                    prose-strong:font-semibold prose-strong:text-white
                    prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:text-[13px] prose-li:marker:text-[#10B981]
                    prose-blockquote:my-2 prose-blockquote:border-l-2 prose-blockquote:border-[#10B981] prose-blockquote:bg-[#10B981]/[0.04] prose-blockquote:px-3 prose-blockquote:py-1 prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-gray-400
                    prose-code:border prose-code:border-[#10B981]/20 prose-code:bg-[#10B981]/10 prose-code:px-1 prose-code:py-[1px] prose-code:font-mono prose-code:text-[11px] prose-code:font-normal prose-code:text-emerald-400
                    prose-table:my-3 prose-table:font-mono prose-table:text-[11px]
                    prose-thead:border-gray-800
                    prose-th:border prose-th:border-gray-800 prose-th:bg-white/[0.03] prose-th:px-2.5 prose-th:py-1.5 prose-th:text-[10px] prose-th:uppercase prose-th:tracking-wider prose-th:text-emerald-400
                    prose-td:border prose-td:border-gray-800 prose-td:px-2.5 prose-td:py-1.5 prose-td:text-gray-300
                    prose-hr:my-4 prose-hr:border-gray-800"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
                </article>
              </>
            ) : status === "running" ? (
              <LoadingSkeleton />
            ) : (
              <BlankSheet />
            )}
          </div>
        </FloatingWindow>

        {settingsOpen && (
          <FloatingWindow
            win={windows.settings}
            title="SETTINGS"
            meta="CONFIG"
            onFocus={() => bringToFront("settings")}
            onDragStart={startInteraction("settings", "move")}
            onResizeStart={startInteraction("settings", "resize")}
            onClose={() => setSettingsOpen(false)}
            className="print:hidden"
          >
            <SettingsPanel
              settings={settings}
              onChange={handleSettingsChange}
              onClearData={handleClearData}
            />
          </FloatingWindow>
        )}
      </div>

      {settings.statusBar && (
        <StatusBar
          online={online}
          edgarOk={sources.edgarOk}
          edgarAt={sources.edgarAt}
          lastAuditAt={sources.lastAuditAt}
          bootedAt={sources.bootedAt}
          version={sources.version}
          theme={settings.theme}
        />
      )}
    </div>
  );
}

const TONE_CLASS = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  err: "text-red-400",
  brand: "text-[#10B981]",
  muted: "text-gray-500",
};

function StatusBar({ online, edgarOk, edgarAt, lastAuditAt, bootedAt, version, theme }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const bootedAtMs = bootedAt ? new Date(bootedAt).getTime() : now;

  return (
    <footer className="flex h-[26px] shrink-0 items-center gap-4 border-t border-gray-800 bg-[#0f1420] px-3 text-[10px] uppercase tracking-[0.14em] text-gray-500 print:hidden">
      <StatusItem label="CONN" value={online ? "ONLINE" : "OFFLINE"} tone={online ? "ok" : "err"} />
      <StatusItem
        label="EDGAR"
        value={edgarOk === null ? "PROBING" : `${edgarOk ? "REACHABLE" : "UNREACHABLE"} @ ${fmtClock(edgarAt)}`}
        tone={edgarOk === null ? "muted" : edgarOk ? "ok" : "warn"}
      />
      <StatusItem label="LAST AUDIT" value={fmtClock(lastAuditAt)} tone="muted" />
      <StatusItem label="SESSION" value={fmtUptime(now - bootedAtMs)} tone="muted" />
      <StatusItem label="THEME" value={theme.toUpperCase()} tone="brand" />

      <div className="ml-auto flex items-center gap-4">
        {version && <StatusItem label="BUILD" value={`v${version}`} tone="muted" />}
        <span className="text-gray-600">{fmtClock(now)}</span>
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

function FloatingWindow({ win, title, meta, onFocus, onDragStart, onResizeStart, onClose, children, className = "" }) {
  return (
    <div
      className={`absolute flex flex-col border border-gray-800 bg-[#0B0F19] ${className}`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDownCapture={onFocus}
    >
      <div
        onPointerDown={onDragStart}
        className="flex h-7 shrink-0 cursor-move touch-none select-none items-center justify-between border-b border-gray-800 bg-white/[0.03] px-2 text-[10px] uppercase tracking-[0.16em]"
      >
        <span className="flex items-center gap-2">
          <span className="text-gray-600" aria-hidden="true">⋮⋮</span>
          <span className="text-gray-300">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-gray-500">{meta}</span>
          {onClose && (
            <button
              type="button"
              aria-label="Close window"
              onPointerDown={(event) => {
                event.stopPropagation();
                onClose();
              }}
              className="grid h-4 w-4 place-items-center text-gray-500 hover:text-red-400"
            >
              ✕
            </button>
          )}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

      <div
        onPointerDown={onResizeStart}
        className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize touch-none"
        aria-hidden="true"
      >
        <span className="absolute bottom-1 right-1 block h-2 w-2 border-b border-r border-gray-600" />
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-hidden="true">
      <div className="h-5 w-2/3 bg-white/[0.06] rounded-none" />
      <div className="h-2 w-1/3 bg-white/[0.04] rounded-none" />
      <div className="space-y-1.5 pt-3">
        <div className="h-2 w-full bg-white/[0.04] rounded-none" />
        <div className="h-2 w-11/12 bg-white/[0.04] rounded-none" />
        <div className="h-2 w-4/5 bg-white/[0.04] rounded-none" />
      </div>
      <div className="h-28 w-full border border-gray-800 bg-white/[0.02] rounded-none" />
      <div className="space-y-1.5 pt-2">
        <div className="h-2 w-full bg-white/[0.04] rounded-none" />
        <div className="h-2 w-3/4 bg-white/[0.04] rounded-none" />
      </div>
    </div>
  );
}

function BlankSheet() {
  return <div className="h-full w-full border border-gray-800 bg-white/[0.015] rounded-none" />;
}
