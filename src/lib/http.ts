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
    throw new Error("Resposta inválida do servidor");
  }
}

let proxyPort: number | null = null;
export async function initProxy() {
  if (inTauri && proxyPort == null) proxyPort = await invoke<number>("proxy_port");
}

/** Wrap a stream url so hls.js / mpegts.js can read it without CORS issues. */
export function proxied(url: string, ua?: string): string {
  if (!inTauri || !proxyPort) return url;
  let s = `http://127.0.0.1:${proxyPort}/p?u=${encodeURIComponent(url)}`;
  if (ua) s += `&ua=${encodeURIComponent(ua)}`;
  return s;
}
