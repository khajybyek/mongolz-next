import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Theme-aware tokens — flip via html[data-theme="light"]
        // (defined in globals.css as space-separated RGB channels).
        bg: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          secondary: "rgb(var(--bg-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--bg-tertiary) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          elevated: "rgb(var(--surface-elevated) / <alpha-value>)",
          overlay: "rgb(var(--surface-overlay) / <alpha-value>)",
          inverse: "rgb(var(--bg) / <alpha-value>)",
        },
        // Borders — soft hairlines; alpha-controllable via globals.css.
        border: {
          DEFAULT: "rgb(var(--border-color) / var(--border-alpha))",
          strong: "rgb(var(--border-color) / var(--border-strong-alpha))",
          accent: "rgb(var(--accent) / 0.30)",
        },
        // Text scale — theme-aware.
        text: {
          DEFAULT: "rgb(var(--text) / <alpha-value>)",
          soft: "rgb(var(--text-soft) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
          faint: "rgb(var(--text-faint) / <alpha-value>)",
          inverse: "rgb(var(--bg) / <alpha-value>)",
        },
        // Accent — also theme-aware (darker in light mode for AA contrast).
        // Static `accent.50..900` scale kept for explicit shade pickers.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          muted: "rgb(var(--accent-muted) / <alpha-value>)",
          glow: "rgb(var(--accent) / 0.35)",
          50: "#e6faff",
          100: "#b3f0ff",
          200: "#80e6ff",
          300: "#4ddcff",
          400: "#1ad2ff",
          500: "#00d4ff",
          600: "#00a8cc",
          700: "#007c99",
          800: "#005066",
          900: "#002433",
        },
        // Secondary accent (violet) — pairs with cyan in gradients and hero art.
        "accent-2": {
          DEFAULT: "#7c3aed",
          soft: "rgba(124,58,237,0.12)",
          ring: "rgba(124,58,237,0.30)",
        },
        // Status colors — slightly desaturated for elegance
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          soft: "rgb(var(--danger) / 0.10)",
          ring: "rgb(var(--danger) / 0.30)",
        },
        success: {
          DEFAULT: "rgb(var(--success) / <alpha-value>)",
          soft: "rgb(var(--success) / 0.10)",
          ring: "rgb(var(--success) / 0.30)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning) / <alpha-value>)",
          soft: "rgb(var(--warning) / 0.10)",
          ring: "rgb(var(--warning) / 0.30)",
        },
        info: {
          DEFAULT: "rgb(var(--info) / <alpha-value>)",
          soft: "rgb(var(--info) / 0.10)",
          ring: "rgb(var(--info) / 0.30)",
        },
      },
      fontFamily: {
        // Geist (Latin + Cyrillic) is self-hosted via next/font; Hangul falls
        // through to the platform's Korean face.
        sans: [
          "var(--font-geist)",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "Malgun Gothic",
          "system-ui",
          "sans-serif",
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // Refined type scale (denser, more dashboard-appropriate)
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.625rem" }],
        "2xl": ["1.375rem", { lineHeight: "1.75rem" }],
        "3xl": ["1.75rem", { lineHeight: "2rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
      },
      borderRadius: {
        sm: "0.375rem",
        DEFAULT: "0.5rem",
        md: "0.625rem",
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // Subtle, layered shadows (multi-stop for depth)
        soft: "0 1px 2px rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)",
        elevated:
          "0 4px 8px rgba(0,0,0,0.20), 0 2px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.04)",
        overlay:
          "0 12px 24px rgba(0,0,0,0.40), 0 4px 8px rgba(0,0,0,0.20), 0 0 0 1px rgba(255,255,255,0.06)",
        glow: "0 0 0 1px rgba(0,212,255,0.30), 0 0 20px rgba(0,212,255,0.20)",
        "glow-soft": "0 0 30px rgba(0,212,255,0.15)",
        "glow-danger": "0 0 0 1px rgba(244,63,94,0.30), 0 0 20px rgba(244,63,94,0.20)",
        "inner-soft": "inset 0 1px 0 rgba(255,255,255,0.05)",
      },
      backgroundImage: {
        // Hero / surface gradients
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-radial-accent":
          "radial-gradient(circle at top, rgba(0,212,255,0.12) 0%, transparent 60%)",
        // Theme-aware: end colour pulls --bg / --bg-secondary so light + dark
        // both flip the background underneath the cyan halo.
        "gradient-hero":
          "radial-gradient(ellipse 80% 60% at 50% -20%, var(--hero-tint, rgba(0,212,255,0.18)) 0%, transparent 60%), linear-gradient(180deg, rgb(var(--bg)) 0%, rgb(var(--bg-secondary)) 100%)",
        "gradient-mesh":
          "radial-gradient(at 20% 20%, var(--mesh-tint-cyan, rgba(0,212,255,0.10)) 0%, transparent 50%), radial-gradient(at 80% 80%, var(--mesh-tint-violet, rgba(124,58,237,0.10)) 0%, transparent 50%)",
        "gradient-accent": "linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "fade-in-up": "fadeInUp 0.3s ease-out",
        "slide-in-right": "slideInRight 0.25s ease-out",
        "slide-in-left": "slideInLeft 0.25s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
        "slide-up": "slideUp 0.28s cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 2s linear infinite",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        slideInLeft: {
          "0%": { opacity: "0", transform: "translateX(-20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0,212,255,0.30)" },
          "50%": { boxShadow: "0 0 0 8px rgba(0,212,255,0)" },
        },
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
