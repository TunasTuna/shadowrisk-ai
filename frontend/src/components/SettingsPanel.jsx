const TOGGLES = [
  {
    key: "restoreSession",
    label: "RESTORE LAST SESSION",
    hint: "Reopen the last ticker, paper and audit log",
  },
  {
    key: "statusBar",
    label: "STATUS BAR",
    hint: "Show the source and session status strip",
  },
];

function Field({ label, children }) {
  return (
    <section className="border-b border-term-line px-3 py-2.5">
      <h4 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-fg-faint">
        {label}
      </h4>
      {children}
    </section>
  );
}

export default function SettingsPanel({ settings, onChange, onClearData }) {
  return (
    <div className="h-full overflow-y-auto text-[11px]">

      {/* Startup Toggles */}
      <Field label="Startup">
        <div className="grid gap-1">
          {TOGGLES.map((toggle) => (
            <label
              key={toggle.key}
              className="flex cursor-pointer items-start gap-2 border border-term-line bg-term-deep px-2 py-1.5 hover:border-fg-faint"
            >
              <input
                type="checkbox"
                checked={Boolean(settings[toggle.key])}
                onChange={(event) => onChange({ [toggle.key]: event.target.checked })}
                className="mt-[2px] h-3.5 w-3.5 shrink-0 cursor-pointer accent-brand"
              />
              <span className="leading-tight">
                <span className="block text-fg">{toggle.label}</span>
                <span className="block text-[10px] normal-case text-fg-faint">
                  {toggle.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      {/* API Endpoint */}
      <Field label="API endpoint">
        <input
          type="text"
          autoComplete="off"
          spellCheck="false"
          value={settings.apiBase}
          onChange={(event) => onChange({ apiBase: event.target.value })}
          placeholder="http://127.0.0.1:8000"
          className="w-full border border-term-line bg-term-deep px-2 py-1.5 text-fg-bright placeholder:text-fg-ghost focus:border-brand/70 focus:outline-none"
        />
        <p className="mt-1.5 text-[10px] normal-case leading-tight text-fg-faint">
          Backend base URL. Default <code className="text-fg-bright">/api</code> routes through the
          Vite dev proxy to the local FastAPI backend. For a remote tunnel, append{" "}
          <code className="text-fg-bright">/api</code> to the tunnel URL (e.g.
          https://xxxx.trycloudflare.com/api). Calls POST /analyze.
        </p>
      </Field>

      {/* Default Ticker */}
      <Field label="Default ticker">
        <input
          type="text"
          autoComplete="off"
          spellCheck="false"
          value={settings.defaultTicker}
          onChange={(event) => onChange({ defaultTicker: event.target.value.toUpperCase() })}
          placeholder="PRELOAD ON BOOT"
          className="w-full border border-term-line bg-term-deep px-2 py-1.5 uppercase tracking-wide text-fg-bright placeholder:text-fg-ghost focus:border-brand/70 focus:outline-none"
        />
      </Field>

      {/* Clear Data Button */}
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onClearData}
          className="w-full border border-red-500/60 px-2 py-1.5 uppercase tracking-[0.18em] text-red-400 transition-colors hover:bg-red-500/10"
        >
          Clear session data
        </button>
      </div>
    </div>
  );
}