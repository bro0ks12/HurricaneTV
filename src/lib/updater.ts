import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateInfo = { version: string; notes: string; install: (onProgress: (pct: number) => void) => Promise<void> };

/** Looks for a newer GitHub release; resolves null when up to date (or not running inside Tauri / offline). */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  const u: Update | null = await check();
  if (!u) return null;
  return {
    version: u.version,
    notes: u.body ?? "",
    install: async (onProgress) => {
      let total = 0;
      let got = 0;
      await u.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total) onProgress(Math.min(100, Math.round((got / total) * 100)));
        }
      });
      await relaunch();
    },
  };
}
