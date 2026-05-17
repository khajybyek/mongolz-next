"use client";

import { useTheme } from "./client";

/**
 * Resolved palette for Recharts SVG props. Recharts inlines these onto the
 * generated <line>/<text>/<rect> elements, so passing a `var(--…)` string
 * would not resolve — concrete colour values are required.
 */
export interface ChartColors {
  /** Axis line + tick label color */
  axis: string;
  /** Grid line color (subtle) */
  grid: string;
  /** Floating tooltip background */
  tooltipBg: string;
  /** Tooltip border */
  tooltipBorder: string;
  /** Tooltip text */
  tooltipText: string;
}

const DARK: ChartColors = {
  axis: "#a1a1aa", // text-soft
  grid: "rgba(255,255,255,0.06)",
  tooltipBg: "#16171f", // surface-elevated
  tooltipBorder: "rgba(255,255,255,0.10)",
  tooltipText: "#f4f4f5",
};

const LIGHT: ChartColors = {
  axis: "#3f3f46", // text-soft (dark)
  grid: "rgba(0,0,0,0.08)",
  tooltipBg: "#ffffff",
  tooltipBorder: "rgba(0,0,0,0.14)",
  tooltipText: "#18181b",
};

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return theme === "light" ? LIGHT : DARK;
}
