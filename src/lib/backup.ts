import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../store/app";
import { inTauri } from "./http";
import { t } from "./i18n";
import type { Settings } from "./settings";
import type { Profile } from "./types";

export interface BackupFile {
  app: "hurricanetv";
  format: 1;
  version: string;
  exportedAt: string;
  profiles: Profile[];
  favs?: Record<string, unknown>;
  history?: Record<string, unknown>;
  lockedCats?: Record<string, string[]>;
  settings?: Partial<Settings>;
}

export interface ExportOptions {
  profileIds: string[];
  favorites: boolean;
  settings: boolean;
}

// never travel with a backup: the PIN would lock a friend out, the TMDB key is personal
const PRIVATE_SETTINGS: (keyof Settings)[] = ["parentalPinHash", "tmdbKey"];

export function buildBackup(o: ExportOptions): BackupFile {
  const s = useApp.getState();
  const ids = new Set(o.profileIds);
  const pick = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => ids.has(k)));
  const settings = { ...s.settings } as Partial<Settings>;
  for (const k of PRIVATE_SETTINGS) delete settings[k];
  return {
    app: "hurricanetv",
    format: 1,
    version: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    profiles: s.profiles.filter((p) => ids.has(p.id)),
    ...(o.favorites ? { favs: pick(s.favs), history: pick(s.history), lockedCats: pick(s.lockedCats) } : {}),
    ...(o.settings ? { settings } : {}),
  };
}

/** Saves to Downloads (desktop app) or triggers a browser download. Returns where it went. */
export async function saveBackup(b: BackupFile): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = b.profiles.length === 1 ? `HurricaneTV - ${b.profiles[0].name} - ${stamp}.json` : `HurricaneTV - backup - ${stamp}.json`;
  const text = JSON.stringify(b, null, 2);
  if (inTauri) return invoke<string>("save_to_downloads", { filename: name, contents: text });
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export async function revealFile(path: string) {
  if (inTauri) await invoke("reveal_path", { path }).catch(() => {});
}

export function parseBackup(text: string): BackupFile {
  let j: BackupFile;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(t("O ficheiro não é um backup válido."));
  }
  if (j?.app !== "hurricanetv" || !Array.isArray(j.profiles)) throw new Error(t("Este ficheiro não é um backup da HurricaneTV."));
  return j;
}

/**
 * Merge a backup in: profiles with the same id are replaced, new ones added;
 * favourites/history of those profiles are replaced; settings only if asked.
 */
export function applyBackup(b: BackupFile, withSettings: boolean) {
  const s = useApp.getState();
  const byId = new Map(s.profiles.map((p) => [p.id, p]));
  for (const p of b.profiles) byId.set(p.id, p);
  const profiles = [...byId.values()];
  useApp.setState({
    profiles,
    activeId: s.activeId ?? b.profiles[0]?.id ?? null,
    favs: { ...s.favs, ...((b.favs as typeof s.favs) ?? {}) },
    history: { ...s.history, ...((b.history as typeof s.history) ?? {}) },
    lockedCats: { ...s.lockedCats, ...(b.lockedCats ?? {}) },
  });
  if (withSettings && b.settings) {
    const clean = { ...b.settings };
    for (const k of PRIVATE_SETTINGS) delete clean[k];
    s.updateSettings(clean);
  }
  return b.profiles.length;
}
