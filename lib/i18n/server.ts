import { cookies } from "next/headers";
import { type Lang, t as translate, type TranslationKey } from "./translations";

const LANG_COOKIE = "mongolz-lang";
const VALID: Lang[] = ["mn", "en", "kr"];

export async function getServerLang(): Promise<Lang> {
  const c = await cookies();
  const v = c.get(LANG_COOKIE)?.value as Lang | undefined;
  return v && VALID.includes(v) ? v : "mn";
}

export async function getT() {
  const lang = await getServerLang();
  return {
    lang,
    t: (key: TranslationKey) => translate(key, lang),
  };
}
