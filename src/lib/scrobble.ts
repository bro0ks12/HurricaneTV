import { useApp, type PlayRequest } from "../store/app";
import { getMeta } from "./meta";
import { scrobble, type ScrobbleItem } from "./movexa";

/** Share of the runtime after which a movie / episode counts as watched (same as Trakt / Plex). */
const WATCHED_AT = 0.9;

// one report per title per app run: seeking back past 90% shouldn't log it again
const reported = new Set<string>();
const flushing = new Set<string>();

async function itemFor(req: PlayRequest): Promise<ScrobbleItem | null> {
  if (req.type === "episode") {
    const t = req.tmdb;
    return t?.season != null && t.episode != null ? { type: "episode", tmdb_id: t.id, season: t.season, episode: t.episode } : null;
  }
  if (req.type !== "vod") return null;
  // movies started from favourites / search carry no TMDB id: look it up like the detail screen does
  const id = req.tmdb?.id ?? (await getMeta("movie", req.title).catch(() => null))?.tmdbId;
  return id ? { type: "movie", tmdb_id: id } : null;
}

/** Called from the player while it saves the position. */
export async function onProgress(req: PlayRequest, position: number, duration: number) {
  if (!duration || position / duration < WATCHED_AT) return;
  const pid = useApp.getState().activeId;
  if (!pid || !useApp.getState().movexa[pid]) return;
  const key = `${pid}:${req.type}:${req.stream}`;
  if (reported.has(key)) return;
  reported.add(key);

  const item = await itemFor(req);
  if (!item) return;
  const s = useApp.getState();
  s.setMovexaQueue(pid, [...(s.movexaQueue[pid] ?? []), item]);
  await flushMovexa(pid);
}

/** Sends a profile's pending titles in order; stops at the first one that should be retried later. */
export async function flushMovexa(pid: string) {
  if (flushing.has(pid)) return;
  flushing.add(pid);
  try {
    for (;;) {
      const s = useApp.getState();
      const link = s.movexa[pid];
      const next = s.movexaQueue[pid]?.[0];
      if (!link || !next) return;
      const r = await scrobble(link.token, next);
      if (r === "retry") return;
      if (r === "unlinked") {
        // revoked from the Movexa website
        s.setMovexaLink(pid, null);
        return;
      }
      // re-read: titles may have been queued while this one was in flight (only this loop removes, so [0] is still `next`)
      const now = useApp.getState();
      now.setMovexaQueue(pid, (now.movexaQueue[pid] ?? []).slice(1));
    }
  } finally {
    flushing.delete(pid);
  }
}

export function flushAllMovexa() {
  for (const pid of Object.keys(useApp.getState().movexa)) void flushMovexa(pid);
}
