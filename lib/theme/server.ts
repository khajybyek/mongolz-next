import { cookies } from "next/headers";
import type { Theme } from "./client";

const COOKIE = "mongolz-theme";

/**
 * Resolve the user's preferred theme on the server so the first HTML
 * payload carries `data-theme="..."` and there's no flash-of-wrong-theme.
 */
export async function getServerTheme(): Promise<Theme> {
  const c = await cookies();
  const v = c.get(COOKIE)?.value;
  return v === "light" ? "light" : "dark";
}
