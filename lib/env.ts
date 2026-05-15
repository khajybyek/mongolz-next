/**
 * Centralized environment detection.
 *
 *   - `production`: Vercel `VERCEL_ENV === "production"` (i.e. alias = mongolz.vercel.app)
 *   - `preview`: Vercel preview deploys (per-commit URLs, also includes `vercel deploy` without --prod)
 *   - `development`: local `npm run dev`
 */

export type AppEnv = "production" | "preview" | "development";

export function appEnv(): AppEnv {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
  if (v === "production") return "production";
  if (v === "preview") return "preview";
  return "development";
}

export function isStaging(): boolean {
  // Vercel preview deploys = staging. We also surface the banner when running
  // dev locally so it's never confused with prod.
  const env = appEnv();
  return env === "preview" || env === "development";
}

export function envLabel(): string {
  switch (appEnv()) {
    case "production":
      return "production";
    case "preview":
      return "staging";
    case "development":
      return "dev";
  }
}
