import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0a1e",
          secondary: "#12122a",
          tertiary: "#1a1a3a",
        },
        accent: {
          DEFAULT: "#00d4ff",
          hover: "#33dfff",
          muted: "#0099cc",
        },
        danger: "#ff3860",
        success: "#23d160",
        warning: "#ffdd57",
      },
      fontFamily: {
        sans: ["var(--font-geist)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
