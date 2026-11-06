import clsx, { type ClassValue } from "clsx";
export const cn = (...c: ClassValue[]) => clsx(c);

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function fmtTime(ms: number, h24 = true) {
  return new Date(ms).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", hour12: !h24 });
}
export function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" });
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

export function pick<T>(arr: T[], n: number) {
  return arr.slice(0, n);
}
