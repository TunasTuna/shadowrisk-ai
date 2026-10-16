const NS = "shadowrisk";

export const KEYS = {
  settings: `${NS}.settings`,
  session: `${NS}.session`,
  sources: `${NS}.sources`,
};

export const DEFAULT_SETTINGS = {
  theme: "terminal",
  restoreSession: true,
  statusBar: true,
  defaultTicker: "",
};

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) — ignore */
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearAll() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(`${NS}.`))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function loadSettings() {
  const stored = load(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) };
}
