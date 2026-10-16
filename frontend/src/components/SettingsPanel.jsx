import { THEMES } from "../lib/theme.js";

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
      <Field label="Theme">
        <div className="grid gap-1">
          {THEMES.map((theme) => {
            const active = settings.theme === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => onChange({ theme: theme.id })}
                className={`flex items-center gap-2 border px-2 py-1.5 text-left uppercase tracking-[0.14em] transition-colors ${active
                  ? "border-brand/60 bg-brand/10 text-white"
                  : "border-term-line bg-term-deep text-fg-dim hover:border-fg-faint hover:text-fg"
                  }`}
              >
                <span
                  className="h-3 w-3 shrink-0 border border-black/50"
                  style={{ background: theme.accent }}
                  aria-hidden="true"
                />
                <span>{theme.label}</span>
                {active && <span className="ml-auto text-brand">ACTIVE</span>}
              </button>
            );
          })}
        </div>
      </Field>

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
