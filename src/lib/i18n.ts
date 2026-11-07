/**
 * Minimal i18n: the Portuguese text is the key, `EN` maps it to English.
 * Missing keys fall back to Portuguese. `{name}` placeholders are filled from `vars`.
 * The whole UI remounts when the language changes (see App.tsx), so plain t() calls are enough.
 */
import { getSettings } from "./settings";
import { DE } from "./i18n.de";
import { EN } from "./i18n.en";
import { ES } from "./i18n.es";
import { FR } from "./i18n.fr";
import { IT } from "./i18n.it";

export type Lang = "pt" | "en" | "es" | "fr" | "de" | "it";

export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: "pt", label: "Português", flag: "🇵🇹" },
  { id: "en", label: "English", flag: "🇬🇧" },
  { id: "es", label: "Español", flag: "🇪🇸" },
  { id: "fr", label: "Français", flag: "🇫🇷" },
  { id: "de", label: "Deutsch", flag: "🇩🇪" },
  { id: "it", label: "Italiano", flag: "🇮🇹" },
];

export const lang = (): Lang => {
  const l = getSettings().language;
  return LANGS.some((x) => x.id === l) ? l : "en";
};
/** BCP-47 locale for dates / Intl */
const LOCALES: Record<Lang, string> = { pt: "pt-PT", en: "en-GB", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" };
export const locale = () => LOCALES[lang()];
const DICTS: Partial<Record<Lang, Record<string, string>>> = { en: EN, es: ES, fr: FR, de: DE, it: IT };

export function t(pt: string, vars?: Record<string, unknown>): string {
  let s = DICTS[lang()]?.[pt] ?? pt;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  return s;
}

/** plural helper: tn(n, "1 canal", "{n} canais") */
export const tn = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });
