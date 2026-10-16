import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--term-bg) / <alpha-value>)",
        term: {
          bg: "rgb(var(--term-bg) / <alpha-value>)",
          deep: "rgb(var(--term-deep) / <alpha-value>)",
          line: "rgb(var(--term-line) / <alpha-value>)",
          soft: "rgb(var(--term-soft) / <alpha-value>)",
        },
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          soft: "rgb(var(--brand-soft) / <alpha-value>)",
          deep: "rgb(var(--brand-deep) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--fg) / <alpha-value>)",
          bright: "rgb(var(--fg-bright) / <alpha-value>)",
          dim: "rgb(var(--fg-dim) / <alpha-value>)",
          faint: "rgb(var(--fg-faint) / <alpha-value>)",
          ghost: "rgb(var(--fg-ghost) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [typography],
};
