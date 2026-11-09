import { t } from "./i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";

export const inTauri = isTauri();

interface RawResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<RawResponse> {
  if (inTauri) {
    return invoke<RawResponse>("http_get", { url, headers });
  }
  // Browser fallback (dev preview): subject to CORS.
  const res = await fetch(url, { headers });
  const out: Record<string, string> = {};
  res.headers.forEach((v, k) => (out[k] = v));
  return { status: res.status, body: await res.text(), headers: out };
}

export async function httpText(url: string, headers?: Record<string, string>): Promise<string> {
  const r = await httpGet(url, headers);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.body;
}

export async function httpJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const text = await httpText(url, headers);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(t("Resposta inválida do servidor"));
  }
}

let proxyPort: number | null = null;
/** True when this build has a TMDB key compiled in (the key itself never reaches JS). */
let tmdbOn = false;
export const tmdbEnabled = () => tmdbOn;
export const tmdbGet = <T = unknown>(path: string, params: Record<string, string> = {}) =>
  invoke<string>("tmdb_get", { path, params }).then((b) => JSON.parse(b) as T);

export async function initProxy() {
  if (inTauri && proxyPort == null) proxyPort = await invoke<number>("proxy_port");
  if (inTauri) tmdbOn = await invoke<boolean>("tmdb_enabled").catch(() => false);
}

export interface StreamHeaders {
  ua?: string;
  referer?: string;
}

/** Wrap a stream url so hls.js / mpegts.js can read it without CORS issues. */
export function proxied(url: string, h?: StreamHeaders, live = false): string {
  if (!inTauri || !proxyPort) return url;
  let s = `http://127.0.0.1:${proxyPort}/p?u=${encodeURIComponent(url)}`;
  if (h?.ua) s += `&ua=${encodeURIComponent(h.ua)}`;
  if (h?.referer) s += `&ref=${encodeURIComponent(h.referer)}`;
  if (live) s += "&live=1";
  return s;
}

export interface ProbeResult {
  kind: "hls" | "ts" | "mp4" | "mkv" | "other";
  status: number;
  content_type: string;
}

/** Sniff the first bytes of a stream (Tauri only). */
export async function probeStream(url: string, h?: StreamHeaders): Promise<ProbeResult | null> {
  if (!inTauri) return null;
  try {
    return await invoke<ProbeResult>("probe_stream", { url, ua: h?.ua ?? null, referer: h?.referer ?? null });
  } catch {
    return null;
  }
}

/** Open in VLC / mpv. Returns the player path used. */
export async function openExternal(url: string, title: string, h?: StreamHeaders, player?: string): Promise<string> {
  if (!inTauri) {
    window.open(url, "_blank");
    return "browser";
  }
  return invoke<string>("open_external", { url, title, ua: h?.ua ?? null, referer: h?.referer ?? null, player: player || null });
}

export interface MkvTrack {
  number: number;
  codec: string;
  lang: string;
  name: string;
  default: boolean;
  forced: boolean;
  text: boolean;
}

/** Subtitle tracks the proxy has found inside an MKV stream (Tauri only). */
export async function mkvTracks(url: string): Promise<MkvTrack[]> {
  if (!inTauri) return [];
  try {
    return await invoke<MkvTrack[]>("mkv_tracks", { url });
  } catch {
    return [];
  }
}

/** Cues of one MKV subtitle track; null when nothing changed since version `since`. */
export async function mkvCues(url: string, track: number, since: number | null): Promise<{ ver: number; cues: { start: number; end: number; text: string }[] } | null> {
  if (!inTauri) return null;
  try {
    return await invoke("mkv_cues", { url, track, since });
  } catch {
    return null;
  }
}
