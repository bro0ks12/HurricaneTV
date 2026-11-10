/**
 * Movexa device-link API (see Movexa's app/api/device/*).
 * The TV shows a QR, the user approves it on their phone, and we poll for a long-lived token.
 */

export const MOVEXA_URL = "https://movexa.matechcorp.net";

export interface MovexaLink {
  token: string;
  /** Movexa display name (or username) shown in the settings */
  user: string | null;
  at: number;
}

export type ScrobbleItem =
  | { type: "movie"; tmdb_id: number }
  | { type: "episode"; tmdb_id: number; season: number; episode: number };

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "pending" }
  | { status: "linked"; link: MovexaLink }
  | { status: "denied" }
  | { status: "expired" };

export type ScrobbleResult = "ok" | "rejected" | "unlinked" | "retry";

function call(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  return fetch(`${MOVEXA_URL}/api/device/${path}`, {
    method: init.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function requestDeviceCode(deviceName: string): Promise<DeviceCode> {
  const res = await call("code", { body: { device_name: deviceName.slice(0, 100) } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  const res = await call("token", { body: { device_code: deviceCode } });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.access_token) {
    return { status: "linked", link: { token: data.access_token, user: data.user?.display_name || data.user?.username || null, at: Date.now() } };
  }
  if (data.error === "access_denied") return { status: "denied" };
  if (data.error === "expired_token") return { status: "expired" };
  return { status: "pending" };
}

export async function scrobble(token: string, item: ScrobbleItem): Promise<ScrobbleResult> {
  try {
    const res = await call("scrobble", { body: item, token });
    if (res.ok) return "ok";
    if (res.status === 401) return "unlinked";
    // the title can't be resolved / bad payload: retrying won't help
    if (res.status >= 400 && res.status < 500) return "rejected";
    return "retry";
  } catch {
    return "retry";
  }
}

/** Best effort: the link is forgotten locally either way. */
export async function unlinkDevice(token: string): Promise<void> {
  await call("self", { method: "DELETE", token }).catch(() => undefined);
}
