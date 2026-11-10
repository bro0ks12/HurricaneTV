import { locale } from "./i18n";
import clsx, { type ClassValue } from "clsx";
export const cn = (...c: ClassValue[]) => clsx(c);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function fmtTime(ms: number, h24 = true) {
  return new Date(ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: !h24 });
}
export function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString(locale(), { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "short" });
}

export function b64(s?: string) {
  if (!s) return "";
  try {
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return s;
  }
}

export function progress(p: { start: number; end: number }, now = Date.now()) {
  if (now <= p.start) return 0;
  if (now >= p.end) return 1;
  return (now - p.start) / (p.end - p.start);
}

/**
 * Guides often contain overlapping or duplicated programmes (a show listed twice with slightly different times).
 * Sort by start, let the later start win, and drop slivers, so each channel is one clean, non-overlapping timeline.
 */
export function tidyPrograms<T extends { start: number; end: number }>(list: T[]): T[] {
  const out: T[] = [];
  for (const p of [...list].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const prev = out[out.length - 1];
    if (prev && p.start < prev.end) {
      if (p.start === prev.start) continue; // same start: keep the first (longest)
      out[out.length - 1] = { ...prev, end: p.start };
    }
    out.push(p);
  }
  return out.filter((p) => p.end - p.start >= 60_000);
}

export function pick<T>(arr: T[], n: number) {
  return arr.slice(0, n);
}
