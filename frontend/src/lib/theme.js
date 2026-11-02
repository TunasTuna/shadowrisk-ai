// frontend/src/lib/theme.js

export const THEMES = [
  { id: "dark", label: "TERMINAL DARK", accent: "rgb(16, 185, 129)" },
  { id: "amber", label: "AMBER", accent: "rgb(245, 158, 11)" },
  { id: "ice", label: "ICE", accent: "rgb(34, 211, 238)" },
  { id: "violet", label: "VIOLET", accent: "rgb(139, 92, 246)" },
  { id: "crimson", label: "CRIMSON", accent: "rgb(244, 63, 94)" },
];

export function applyTheme(themeId) {
  const root = document.documentElement;

  // If it's the default dark theme, remove the attribute to fall back to :root
  if (themeId === "dark" || !themeId) {
    root.removeAttribute("data-theme");
  } else {
    // Otherwise, set the data-theme attribute, which your index.css already listens to
    root.setAttribute("data-theme", themeId);
  }
}