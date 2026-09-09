/** @type {import('tailwindcss').Config} */
const color = (token) => `rgb(var(${token}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: color("--color-background"),
        surface: color("--color-surface"),
        "surface-muted": color("--color-surface-muted"),
        primary: color("--color-text-primary"),
        secondary: color("--color-text-secondary"),
        muted: color("--color-text-muted"),
        default: color("--color-border"),
        strong: color("--color-border-strong"),
        brand: color("--color-brand"),
        "brand-hover": color("--color-brand-hover"),
        "brand-soft": color("--color-brand-soft"),
        success: color("--color-success"),
        "success-soft": color("--color-success-soft"),
        warning: color("--color-warning"),
        "warning-soft": color("--color-warning-soft"),
        danger: color("--color-danger"),
        "danger-soft": color("--color-danger-soft"),
        info: color("--color-info"),
        "info-soft": color("--color-info-soft"),
      },
      borderRadius: {
        control: "var(--radius-md)",
        card: "var(--radius-lg)",
        dialog: "var(--radius-xl)",
      },
      boxShadow: {
        surface: "var(--shadow-surface)",
      },
      fontSize: {
        "page-title": ["1.875rem", { lineHeight: "2.25rem", fontWeight: "700" }],
        "section-title": ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        "card-title": ["1rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "400" }],
        label: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "600" }],
        helper: ["0.8125rem", { lineHeight: "1.125rem", fontWeight: "400" }],
      },
    },
  },
  plugins: [],
}
