/**
 * Movie / series metadata: poster, backdrop, synopsis, IMDb rating, cast…
 *
 * - Cinemeta (public, no key): IMDb ids + rating, posters, cast names, episode stills.
 * - TMDB (key compiled into the app, see src-tauri/build.rs): Portuguese synopsis/titles and cast photos.
 *
 * Results are cached in localStorage so each title is looked up once.
 */
import { lang, t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { httpJson, tmdbEnabled, tmdbGet } from "./http";
import { getSettings } from "./settings";

export type MetaKind = "movie" | "series";

export interface CastMember {
  name: string;
  character?: string;
  photo?: string;
}

export interface EpisodeMeta {
  title?: string;
  plot?: string;
  thumb?: string;
  aired?: string;
}

export interface Meta {
  imdbId?: string;
  tmdbId?: number;
  title: string;
  year?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  plot?: string;
  imdbRating?: number;
  tmdbRating?: number;
  genres: string[];
  runtime?: string;
  director: string[];
  cast: CastMember[];
  trailer?: string;
  /** key "season:episode" */
  episodes?: Record<string, EpisodeMeta>;
  /** how sure we are the match is right (exact title + year) */
  confident: boolean;
}

/* ---------------- title cleaning ---------------- */

const NOISE =
  /\b(4k|uhd|fhd|hd|sd|hevc|h\.?26[45]|x26[45]|1080p|720p|2160p|480p|multi|dual|vostfr|vost|legendado|dublado|leg|dub|sub|subs|pt-?br|pt-?pt|webrip|web-?dl|bluray|brrip|hdrip|dvdrip|remux|hdr|dv|atmos|aac|ac3|dts|5\.1|7\.1)\b/gi;

export function cleanTitle(raw: string): { title: string; year?: string } {
  let s = raw.trim();
  // provider prefixes: "PT | ", "PT - ", "[PT] ", "|EN| ", "EN: " (uppercase codes only,
  // and "-" needs spaces, so "Ant-Man" or "X-Men" are left alone)
  s = s.replace(/^(\[[^\]]{1,12}\]|\|[^|]{1,8}\||[A-Z]{2,4}\s*[|:]|[A-Z]{2,4}\s+[-–]\s)\s*/, "");
  // "Black.Doves.2024.1080p" -> spaces
  if (!/\s/.test(s)) s = s.replace(/[._]+/g, " ");
  // episode markers and everything after them
  s = s.replace(/\bS\d{1,2}\s*E\d{1,3}\b.*$/i, "");
  // year: last plausible one, bracketed or free-standing
  const year = [...s.matchAll(/(?:^|[\s([._])((?:19|20)\d{2})(?=$|[\s)\]._])/g)].pop()?.[1];
  // drop bracketed tags, quality/language noise, then the year itself
  s = s.replace(/\[[^\]]*\]|\((?!(?:19|20)\d{2}\))[^)]*\)/g, " ");
  s = s.replace(NOISE, " ");
  if (year) s = s.replace(new RegExp(`[([]?\\b${year}\\b[)\\]]?`, "g"), " ");
  s = s.replace(/[_]+/g, " ").replace(/\s*[|–-]\s*$/, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  // a title that *is* a year ("1917", "2012") must survive
  return { title: s || raw.trim(), year: s ? year : undefined };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ") // keep non-Latin scripts (Greek, Cyrillic, Arabic, CJK…) instead of emptying them
    .trim();

/* ---------------- cache ---------------- */

const CACHE_KEY = "hurricane-meta-v3";
const TTL_HIT = 30 * 864e5;
const TTL_MISS = 3 * 864e5;
const MAX_ENTRIES = 4000;

type Entry = { at: number; m: Meta | null };
let cache: Record<string, Entry> | null = null;
let saveT: number | undefined;

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    cache = {};
  }
  return cache!;
}
function saveCache() {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(() => {
    const c = loadCache();
    const keys = Object.keys(c);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => c[a].at - c[b].at);
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete c[k];
    }
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch {
      /* quota: drop the cache rather than break the app */
      localStorage.removeItem(CACHE_KEY);
    }
  }, 800);
}
export function clearMetaCache() {
  cache = {};
  localStorage.removeItem(CACHE_KEY);
}

const memo = new Map<string, Promise<Meta | null>>();

/* ---------------- request queue (be nice to the APIs) ---------------- */

let active = 0;
const waiting: (() => void)[] = [];
async function queued<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const GENRES_PT: Record<string, string> = {
  action: "Ação", adventure: "Aventura", animation: "Animação", biography: "Biografia", comedy: "Comédia", crime: "Crime",
  documentary: "Documentário", drama: "Drama", family: "Família", fantasy: "Fantasia", "film-noir": "Film-Noir", history: "História",
  horror: "Terror", music: "Música", musical: "Musical", mystery: "Mistério", news: "Notícias", "reality-tv": "Reality TV",
  romance: "Romance", "sci-fi": "Ficção científica", "science fiction": "Ficção científica", sport: "Desporto", "talk-show": "Talk Show",
  thriller: "Thriller", war: "Guerra", western: "Western", "game-show": "Concurso",
};
const ptGenre = (g: string) => GENRES_PT[g.toLowerCase()] ?? g;

/** Genre label in the UI language (works for English ids, cached Portuguese names and already-localised TMDB names). */
export const genreName = (g: string) => t(GENRES_PT[g.toLowerCase()] ?? g);

/* ---------------- Cinemeta ---------------- */

const CM = "https://v3-cinemeta.strem.io";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const ARTICLES = /^(the|a|an|o|a|os|as|el|la|los|las|le|les|il|der|die|das)\s+/;
const words = (s: string) => norm(s).replace(ARTICLES, "").split(" ").filter(Boolean);

/** 0..1 title similarity: exact (ignoring leading articles) = 1, otherwise word overlap */
export function titleSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  if (wa.join(" ") === wb.join(" ")) return 1;
  const sa = new Set(wa);
  const sb = new Set(wb);
  const inter = [...sa].filter((w) => sb.has(w)).length;
  return inter / Math.max(sa.size, sb.size);
}

/**
 * Choose the best search hit. `confident` is only true when the title really
 * matches (and the year agrees when we know it) — a wrong synopsis/cast is
 * worse than none, so callers discard non-confident hits.
 */
function pickBest<T>(items: T[], title: string, year: string | undefined, names: (x: T) => string[], yr: (x: T) => string | undefined) {
  let best: { item: T; sim: number; yearOk: boolean | null; score: number } | null = null;
  items.slice(0, 10).forEach((it, i) => {
    const sim = Math.max(...names(it).filter(Boolean).map((n) => titleSimilarity(title, n)), 0);
    const y = yr(it)?.slice(0, 4);
    const yearOk = year && y ? Math.abs(Number(y) - Number(year)) <= 1 : null;
    let score = sim * 100 + (10 - i);
    if (yearOk === true) score += y === year ? 40 : 20;
    if (yearOk === false) score -= 60;
    if (!best || score > best.score) best = { item: it, sim, yearOk, score };
  });
  if (!best) return null;
  const b = best as { item: T; sim: number; yearOk: boolean | null };
  const confident = b.yearOk !== false && (b.sim === 1 || (b.sim >= 0.75 && b.yearOk === true));
  return { item: b.item, confident };
}

async function cinemetaMeta(kind: MetaKind, imdbId: string): Promise<Any | null> {
  const r = await queued(() => httpJson<Any>(`${CM}/meta/${kind}/${imdbId}.json`)).catch(() => null);
  return r?.meta ?? null;
}

function fromCinemeta(m: Any, confident: boolean): Meta {
  const episodes: Record<string, EpisodeMeta> = {};
  for (const v of m.videos ?? []) {
    if (v.season == null) continue;
    episodes[`${v.season}:${v.episode ?? v.number}`] = {
      title: v.name || v.title,
      plot: v.overview || v.description,
      thumb: v.thumbnail,
      aired: v.released || v.firstAired,
    };
  }
  const rating = Number(m.imdbRating);
  return {
    imdbId: m.imdb_id || m.id,
    tmdbId: m.moviedb_id,
    title: m.name,
    year: String(m.year ?? m.releaseInfo ?? "").slice(0, 4) || undefined,
    poster: m.poster?.replace(/_V1_.*?\.jpg$/, "_V1_SX500.jpg"),
    backdrop: m.background,
    logo: m.logo,
    plot: m.description,
    imdbRating: rating > 0 ? rating : undefined,
    genres: (m.genres ?? m.genre ?? []).map(ptGenre),
    runtime: m.runtime,
    director: m.director ?? [],
    cast: (m.cast ?? []).map((name: string) => ({ name })),
    trailer: m.trailers?.[0]?.source,
    episodes: Object.keys(episodes).length ? episodes : undefined,
    confident,
  };
}

async function viaCinemeta(kind: MetaKind, title: string, year?: string): Promise<Meta | null> {
  const q = encodeURIComponent(title);
  const r = await queued(() => httpJson<Any>(`${CM}/catalog/${kind}/top/search=${q}.json`)).catch(() => null);
  const metas: Any[] = r?.metas ?? [];
  const best = pickBest(metas, title, year, (m) => [m.name], (m) => m.releaseInfo);
  if (!best) return null;
  const full = await cinemetaMeta(kind, best.item.imdb_id || best.item.id);
  return fromCinemeta(full ?? best.item, best.confident);
}

/* ---------------- TMDB (when the build has a key) ---------------- */

const TMDB_LANG = { pt: "pt-PT", en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT" } as const;
const IMG = "https://image.tmdb.org/t/p/";

const tmdb = (path: string, params: Record<string, string> = {}) => queued(() => tmdbGet<Any>(path, { language: TMDB_LANG[lang()], ...params }));

async function viaTmdb(kind: MetaKind, title: string, year?: string): Promise<Meta | null> {
  const type = kind === "movie" ? "movie" : "tv";
  const s = await tmdb(`/search/${type}`, { query: title, ...(year ? { [kind === "movie" ? "year" : "first_air_date_year"]: year } : {}) });
  let results: Any[] = s?.results ?? [];
  if (!results.length && year) results = (await tmdb(`/search/${type}`, { query: title }))?.results ?? [];
  const best = pickBest(
    results,
    title,
    year,
    // TMDB titles are localized: also match the original title
    (r) => [r.title || r.name, r.original_title || r.original_name],
    (r) => r.release_date || r.first_air_date,
  );
  if (!best) return null;
  const d = await tmdb(`/${type}/${best.item.id}`, { append_to_response: "credits,external_ids,videos", include_video_language: "pt,en" });
  if (!d) return null;
  // Portuguese overview can be empty: fall back to English
  let plot: string | undefined = d.overview;
  if (!plot) plot = (await tmdb(`/${type}/${best.item.id}`, { language: "en-US" }).catch(() => null))?.overview;
  const imdbId: string | undefined = d.imdb_id || d.external_ids?.imdb_id;
  // IMDb rating itself comes from Cinemeta (keyless)
  const cm = imdbId ? await cinemetaMeta(kind, imdbId) : null;
  const base = cm ? fromCinemeta(cm, best.confident) : null;
  const confident = best.confident;
  const runtime = d.runtime || d.episode_run_time?.[0];
  return {
    imdbId,
    tmdbId: d.id,
    title: d.title || d.name,
    year: String(d.release_date || d.first_air_date || "").slice(0, 4) || undefined,
    poster: d.poster_path ? `${IMG}w500${d.poster_path}` : base?.poster,
    backdrop: d.backdrop_path ? `${IMG}w1280${d.backdrop_path}` : base?.backdrop,
    logo: base?.logo,
    plot: plot || base?.plot,
    imdbRating: base?.imdbRating,
    tmdbRating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
    genres: (d.genres ?? []).map((g: Any) => g.name),
    runtime: runtime ? `${runtime} min` : base?.runtime,
    director: (d.credits?.crew ?? []).filter((c: Any) => c.job === "Director").map((c: Any) => c.name).slice(0, 3).concat(d.created_by?.map((c: Any) => c.name) ?? []),
    cast: (d.credits?.cast ?? []).slice(0, 15).map((c: Any) => ({ name: c.name, character: c.character, photo: c.profile_path ? `${IMG}w185${c.profile_path}` : undefined })),
    trailer: d.videos?.results?.find((v: Any) => v.site === "YouTube" && v.type === "Trailer")?.key ?? base?.trailer,
    episodes: base?.episodes,
    confident,
  };
}

/** Portuguese episode names/plots/stills for one season (TMDB only). */
export async function seasonMeta(tmdbId: number, season: number): Promise<Record<string, EpisodeMeta>> {
  if (!tmdbEnabled()) return {};
  const d = await tmdb(`/tv/${tmdbId}/season/${season}`).catch(() => null);
  const out: Record<string, EpisodeMeta> = {};
  for (const e of d?.episodes ?? []) {
    out[`${season}:${e.episode_number}`] = { title: e.name, plot: e.overview || undefined, thumb: e.still_path ? `${IMG}w400${e.still_path}` : undefined, aired: e.air_date };
  }
  return out;
}

/* ---------------- public API ---------------- */

export function getMeta(kind: MetaKind, rawName: string, yearHint?: string): Promise<Meta | null> {
  const { title, year: y } = cleanTitle(rawName);
  const year = (yearHint && /^\d{4}/.test(yearHint) ? yearHint.slice(0, 4) : undefined) ?? y;
  const useTmdb = tmdbEnabled();
  const key = `${useTmdb ? `t-${lang()}` : "c"}:${kind}:${norm(title)}:${year ?? ""}`;
  const c = loadCache()[key];
  if (c && Date.now() - c.at < (c.m ? TTL_HIT : TTL_MISS)) return Promise.resolve(c.m);
  let p = memo.get(key);
  if (!p) {
    p = (async () => {
      let m: Meta | null = null;
      try {
        m = useTmdb ? await viaTmdb(kind, title, year) : null;
        if (m && !m.confident) m = null;
      } catch {
        m = null; // bad key / offline: fall back
      }
      if (!m) m = await viaCinemeta(kind, title, year).catch(() => null);
      // never show the synopsis / cast of a different title
      if (m && !m.confident) m = null;
      loadCache()[key] = { at: Date.now(), m };
      saveCache();
      return m;
    })().finally(() => memo.delete(key));
    memo.set(key, p);
  }
  return p;
}

/** Lazily fetch metadata once `enabled` (e.g. when the card scrolls into view). */
export function useMeta(kind: MetaKind, name: string | undefined, year?: string, enabled = true) {
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  useEffect(() => {
    if (!name || !enabled || !getSettings().metadata) return;
    let alive = true;
    getMeta(kind, name, year).then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [kind, name, year, enabled]);
  return meta;
}

/** true once the element has been near the viewport */
export function useInView<T extends Element>(margin = "300px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return { ref, seen };
}
