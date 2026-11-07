import { locale } from "./i18n";
/** Parse SRT / WebVTT / (basic) ASS-SSA subtitle files into plain cues. */

export interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

const ts = (s: string) => {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345 | 0:01:02.34 (ass)
  const m = s.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
  if (!m) return NaN;
  const [, h = "0", mi, se, frac] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(se) + Number(frac.padEnd(3, "0")) / 1000;
};

function parseSrtVtt(text: string): Cue[] {
  const out: Cue[] = [];
  const blocks = text.replace(/\r/g, "").replace(/^﻿/, "").split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split("\n");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, z] = lines[i].split("-->");
    const start = ts(a);
    const end = ts(z);
    const body = lines
      .slice(i + 1)
      .join("\n")
      .replace(/<(?!\/?[biu]>)[^>]+>/gi, "") // keep only <b><i><u>
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && body) out.push({ start, end, text: body });
  }
  return out;
}

function parseAss(text: string): Cue[] {
  const out: Cue[] = [];
  let fmt: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (/^\[Events\]/i.test(line)) fmt = [];
    if (/^Format:/i.test(line)) fmt = line.slice(7).split(",").map((s) => s.trim().toLowerCase());
    if (!/^Dialogue:/i.test(line) || !fmt.length) continue;
    const parts = line.slice(9).split(",");
    const textIdx = fmt.indexOf("text");
    const get = (k: string) => parts[fmt.indexOf(k)]?.trim() ?? "";
    const body = parts
      .slice(textIdx)
      .join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/gi, "\n")
      .replace(/\\h/g, " ")
      .trim();
    const start = ts(get("start"));
    const end = ts(get("end"));
    if (Number.isFinite(start) && Number.isFinite(end) && body) out.push({ start, end, text: body });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(text: string, filename = ""): Cue[] {
  if (/\.(ass|ssa)$/i.test(filename) || /^\s*\[Script Info\]/i.test(text)) return parseAss(text);
  return parseSrtVtt(text);
}

/** Decode a subtitle file, falling back to Windows-1252 for legacy SRTs (common for PT). */
export async function readSubtitleFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  return new TextDecoder("windows-1252").decode(buf);
}

// ISO 639-2 (incl. bibliographic "B" codes used by MKV) -> ISO 639-1
const ISO3: Record<string, string> = {
  por: "pt", pob: "pt", eng: "en", spa: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", dut: "nl", nld: "nl",
  pol: "pl", rus: "ru", ukr: "uk", ara: "ar", tur: "tr", cat: "ca", cze: "cs", ces: "cs", dan: "da", gre: "el", ell: "el",
  baq: "eu", eus: "eu", fin: "fi", fil: "fil", glg: "gl", heb: "he", hrv: "hr", hun: "hu", ind: "id", jpn: "ja", kor: "ko",
  may: "ms", msa: "ms", nob: "nb", nor: "no", rum: "ro", ron: "ro", swe: "sv", tha: "th", vie: "vi", chi: "zh", zho: "zh",
  hin: "hi", bul: "bg", srp: "sr", slv: "sl", slo: "sk", slk: "sk", est: "et", lav: "lv", lit: "lt", ice: "is", isl: "is",
  per: "fa", fas: "fa", tam: "ta", tel: "te", ben: "bn", urd: "ur",
};

/** "por" / "pt-BR" / "pt" -> "pt" (lowercase base language) */
export function baseLang(lang?: string): string {
  if (!lang) return "";
  const l = lang.toLowerCase().split(/[-_]/)[0];
  return ISO3[l] ?? l;
}

let names: Intl.DisplayNames | null = null;
/** Human name in Portuguese: "ger" -> "Alemão", "pt-BR" -> "Português (Brasil)" */
export function langName(lang?: string): string {
  if (!lang || /^(und|mul|zxx|mis)$/i.test(lang)) return "";
  try {
    names ??= new Intl.DisplayNames([locale()], { type: "language" });
    const parts = lang.split(/[-_]/);
    const code = [baseLang(parts[0]), ...parts.slice(1)].join("-");
    const n = names.of(code);
    if (n && n.toLowerCase() !== code.toLowerCase()) return n.charAt(0).toUpperCase() + n.slice(1);
  } catch {
    /* ignore */
  }
  return lang.toUpperCase();
}

export const langMatches = (lang: string | undefined, want: string) => !!lang && !!want && baseLang(lang) === baseLang(want);