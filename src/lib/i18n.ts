/**
 * Minimal i18n: the Portuguese text is the key, `EN` maps it to English.
 * Missing keys fall back to Portuguese. `{name}` placeholders are filled from `vars`.
 * The whole UI remounts when the language changes (see App.tsx), so plain t() calls are enough.
 */
import { getSettings } from "./settings";
import { EN } from "./i18n.en";

export type Lang = "pt" | "en";

export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: "pt", label: "Português", flag: "🇵🇹" },
  { id: "en", label: "English", flag: "🇬🇧" },
];

export const lang = (): Lang => (getSettings().language === "en" ? "en" : "pt");
/** BCP-47 locale for dates / Intl */
export const locale = () => (lang() === "en" ? "en-GB" : "pt-PT");

export function t(pt: string, vars?: Record<string, unknown>): string {
  let s = lang() === "en" ? (EN[pt] ?? pt) : pt;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  return s;
}

/** plural helper: tn(n, "1 canal", "{n} canais") */
export const tn = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });
