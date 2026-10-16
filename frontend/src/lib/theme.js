export const THEMES = [
  { id: "terminal", label: "TERMINAL GREEN", accent: "#10B981" },
  { id: "amber", label: "AMBER CRT", accent: "#F59E0B" },
  { id: "ice", label: "ICE BLUE", accent: "#22D3EE" },
  { id: "violet", label: "VIOLET DESK", accent: "#8B5CF6" },
  { id: "crimson", label: "CRIMSON RISK", accent: "#F43F5E" },
];

export const DEFAULT_THEME = "terminal";

export function isThemeId(id) {
  return THEMES.some((t) => t.id === id);
}

export function applyTheme(id) {
  const safe = isThemeId(id) ? id : DEFAULT_THEME;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", safe);
  }
  return safe;
}
