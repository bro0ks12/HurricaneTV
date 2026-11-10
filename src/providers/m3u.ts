import { loadPlaylist } from "../lib/files";
import { httpText } from "../lib/http";
import { t } from "../lib/i18n";
import { tidyPrograms } from "../lib/util";
import type { Category, Channel, Episode, Profile, Program, Provider, SeriesInfo, SeriesItem, VodItem } from "../lib/types";

interface Entry {
  name: string;
  attrs: Record<string, string>;
  url: string;
  ua?: string;
  referer?: string;
}

/** Kodi-style "url|User-Agent=x&Referer=y" header suffix */
function splitPipe(raw: string): { url: string; ua?: string; referer?: string } {
  const i = raw.indexOf("|");
  if (i < 0) return { url: raw };
  const out: { url: string; ua?: string; referer?: string } = { url: raw.slice(0, i) };
  for (const kv of raw.slice(i + 1).split("&")) {
    const [k, ...rest] = kv.split("=");
    let v = rest.join("=");
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep raw */
    }
    if (/^user-agent$/i.test(k)) out.ua = v;
    if (/^referr?er$/i.test(k)) out.referer = v;
  }
  return out;
}

interface Parsed {
  epgUrl?: string;
  live: Channel[];
  vod: VodItem[];
  series: (SeriesItem & { episodes: Episode[] })[];
  liveCats: Category[];
  vodCats: Category[];
  seriesCats: Category[];
}

const ATTR = /([\w-]+)="([^"]*)"/g;
const EP = /^(.*?)[\s._-]*S(\d{1,2})\s*E(\d{1,3})/i;
const VOD_EXT = /\.(mp4|mkv|avi|mov|wmv|m4v|webm)(\?|$)/i;

function parseM3u(text: string): { header: Record<string, string>; entries: Entry[] } {
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  const entries: Entry[] = [];
  let cur: Omit<Entry, "url"> | null = null;
  // #EXTVLCOPT may come before or after #EXTINF
  let pending: { ua?: string; referer?: string } = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) {
      for (const m of line.matchAll(ATTR)) header[m[1].toLowerCase()] = m[2];
    } else if (line.startsWith("#EXTINF")) {
      const attrs: Record<string, string> = {};
      // attributes live between "#EXTINF:-1" and the last top-level comma
      const commaIdx = line.lastIndexOf('",') >= 0 ? line.indexOf(",", line.lastIndexOf('"')) : line.indexOf(",");
      const meta = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      for (const m of meta.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2];
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : attrs["tvg-name"] || "Sem nome";
      cur = { name, attrs, ...pending };
      pending = {};
      if (attrs["user-agent"]) cur.ua = attrs["user-agent"];
      if (attrs["http-referrer"] || attrs["referer"]) cur.referer = attrs["http-referrer"] || attrs["referer"];
    } else if (line.startsWith("#EXTVLCOPT:")) {
      const [k, ...rest] = line.slice(11).split("=");
      const v = rest.join("=").trim();
      const tgt = cur ?? pending;
      if (/http-user-agent/i.test(k)) tgt.ua = v;
      if (/http-referr?er/i.test(k)) tgt.referer = v;
    } else if (line.startsWith("#EXTHTTP:")) {
      try {
        const j = JSON.parse(line.slice(9));
        const tgt = cur ?? pending;
        tgt.ua = j["User-Agent"] ?? j["user-agent"] ?? tgt.ua;
        tgt.referer = j["Referer"] ?? j["referer"] ?? tgt.referer;
      } catch {
        /* ignore */
      }
    } else if (line.startsWith("#EXTGRP:") && cur) {
      cur.attrs["group-title"] ||= line.slice(8).trim();
    } else if (!line.startsWith("#") && cur) {
      const p = splitPipe(line);
      entries.push({ ...cur, url: p.url, ua: p.ua ?? cur.ua, referer: p.referer ?? cur.referer });
      cur = null;
    }
  }
  return { header, entries };
}

function catsOf(items: { categoryId?: string }[]): Category[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const k = i.categoryId || "Sem categoria";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ id: name, name, count }));
}

const VOD_GROUP = /^\s*(filmes?|movies?|films?|vod|cinema|pel[ií]culas?)\b/i;
const SERIES_GROUP = /^\s*(s[ée]ries?|tv ?shows?|shows|novelas?)\b/i;

/**
 * Live vs movie vs series. Order: explicit tvg-type, then the group-title
 * ("Filmes | …", "Séries | …"), then the URL (Xtream /movie/ /series/ paths,
 * file extensions). A movie served as HLS (.m3u8) is only recognised by the
 * first two, since its URL looks exactly like a live channel's.
 */
function kindOf(e: Entry, group: string): "live" | "vod" | "series" {
  const type = (e.attrs["tvg-type"] || e.attrs["type"] || "").toLowerCase();
  if (/^(movies?|vod|films?)$/.test(type)) return "vod";
  if (/^(series|shows?|tv)$/.test(type)) return "series";
  if (/^(live|channel|tv-live)$/.test(type)) return "live";
  if (SERIES_GROUP.test(group)) return "series";
  if (VOD_GROUP.test(group)) return EP.test(e.name) ? "series" : "vod";
  if (/\/series\//i.test(e.url) || (VOD_EXT.test(e.url) && EP.test(e.name))) return "series";
  if (/\/movie\//i.test(e.url) || VOD_EXT.test(e.url)) return "vod";
  return "live";
}

function build(text: string): Parsed {
  const { header, entries } = parseM3u(text);
  const live: Channel[] = [];
  const vod: VodItem[] = [];
  const seriesMap = new Map<string, SeriesItem & { episodes: Episode[] }>();
  let n = 0;
  entries.forEach((e, idx) => {
    const group = e.attrs["group-title"] || "Sem categoria";
    const logo = e.attrs["tvg-logo"] || undefined;
    const kind = kindOf(e, group);
    const isSeries = kind === "series";
    const isVod = kind === "vod";
    if (isSeries) {
      const m = e.name.match(EP);
      // no SxxExx in the name: fall back to the series name in "Séries | Nome"
      const fromGroup = group.includes("|") ? group.split("|").pop()!.trim() : "";
      const title = (m?.[1] || fromGroup || e.name).replace(/[\s._-]+$/, "").trim() || e.name;
      const key = `${group}::${title.toLowerCase()}`;
      let s = seriesMap.get(key);
      if (!s) {
        s = { id: key, name: title, poster: logo, categoryId: group, episodes: [] };
        seriesMap.set(key, s);
      }
      s.episodes.push({
        id: String(idx),
        season: Number(m?.[2] ?? 1),
        num: Number(m?.[3] ?? s.episodes.length + 1),
        title: e.name,
        image: logo,
        stream: e.url,
        ua: e.ua,
        referer: e.referer,
      });
    } else if (isVod) {
      vod.push({ id: String(idx), name: e.name, poster: logo, categoryId: group, stream: e.url, ua: e.ua, referer: e.referer });
    } else {
      n++;
      live.push({
        id: String(idx),
        num: Number(e.attrs["tvg-chno"]) || n,
        name: e.name,
        logo,
        categoryId: group,
        epgId: e.attrs["tvg-id"] || e.attrs["tvg-name"] || undefined,
        catchup: !!e.attrs["catchup"] || !!e.attrs["catchup-source"] || !!e.attrs["timeshift"],
        catchupDays: Number(e.attrs["catchup-days"] || e.attrs["timeshift"]) || undefined,
        isRadio: e.attrs["radio"] === "true" || /radio/i.test(group),
        stream: e.url,
        ua: e.ua,
        referer: e.referer,
      });
      catchupInfo.set(String(idx), { mode: e.attrs["catchup"] || "default", source: e.attrs["catchup-source"] });
    }
  });
  const series = [...seriesMap.values()];
  return {
    epgUrl: header["url-tvg"] || header["x-tvg-url"],
    live,
    vod,
    series,
    liveCats: catsOf(live),
    vodCats: catsOf(vod),
    seriesCats: catsOf(series),
  };
}

const catchupInfo = new Map<string, { mode: string; source?: string }>();

/* ---------------- XMLTV ---------------- */

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

function xmltvDate(s: string): number {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return NaN;
  const [, Y, M, D, h, mi, sec = "00", tz = "+0000"] = m;
  const utc = Date.UTC(+Y, +M - 1, +D, +h, +mi, +sec);
  const sign = tz[0] === "-" ? -1 : 1;
  const off = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return utc - off * 60000;
}

/** Xtream-style panels serve the guide at /xmltv.php with the same credentials as get.php. */
function xmltvFromPanel(url?: string): string | undefined {
  try {
    const u = new URL(url ?? "");
    const user = u.searchParams.get("username");
    const pass = u.searchParams.get("password");
    if (!/\/get\.php$/i.test(u.pathname) || !user || !pass) return undefined;
    return `${u.origin}${u.pathname.replace(/get\.php$/i, "xmltv.php")}?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  } catch {
    return undefined;
  }
}

async function loadXmltv(url: string, wanted: Set<string>): Promise<Map<string, Program[]>> {
  const text = await httpText(url);
  const out = new Map<string, Program[]>();
  const now = Date.now();
  const lo = now - 7 * 864e5;
  const hi = now + 2 * 864e5;
  const re = /<programme\s([^>]*)>([\s\S]*?)<\/programme>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(ATTR)) attrs[a[1]] = a[2];
    const ch = attrs.channel;
    if (!ch || (wanted.size && !wanted.has(ch.toLowerCase()))) continue;
    const start = xmltvDate(attrs.start);
    const end = xmltvDate(attrs.stop);
    if (!(end > lo && start < hi)) continue;
    const title = decode(m[2].match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const description = decode(m[2].match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1] ?? "");
    const key = ch.toLowerCase();
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ title, description, start, end });
  }
  for (const [k, list] of out) out.set(k, tidyPrograms(list));
  return out;
}

/* ---------------- Provider ---------------- */

export function createM3u(p: Profile): Provider {
  let parsed: Promise<Parsed> | null = null;
  let epg: Promise<Map<string, Program[]>> | null = null;
  const source = async () => {
    if (!p.file) return httpText(p.url!);
    const text = await loadPlaylist(p.id);
    if (!text) throw new Error(t("O ficheiro da playlist já não está guardado — importa-o outra vez."));
    return text;
  };
  const data = () => (parsed ??= source().then(build));
  // EPG sources, best first: the profile's own, the playlist header (may list several), then the panel's xmltv.php
  const epgCandidates = (d: Parsed) => [...new Set([p.epgUrl, ...(d.epgUrl ?? "").split(","), xmltvFromPanel(p.url)].map((u) => u?.trim()).filter(Boolean) as string[])];
  const guide = async () => {
    const d = await data();
    const wanted = new Set(d.live.map((c) => c.epgId?.toLowerCase()).filter(Boolean) as string[]);
    if (epg) return epg;
    const found = (async () => {
      for (const url of epgCandidates(d)) {
        const m = await loadXmltv(url, wanted).catch(() => null);
        if (m?.size) return m;
      }
      return new Map<string, Program[]>();
    })();
    const m = await found;
    if (m.size) epg = found; // don't cache a failed/empty guide: retry next time
    return m;
  };
  const progsFor = async (ch: Channel) => (ch.epgId ? (await guide()).get(ch.epgId.toLowerCase()) ?? [] : []);

  return {
    kind: "m3u",
    async account() {
      const d = await data();
      return {
        status: "Active",
        expires: null,
        serverUrl: p.file ? t("Ficheiro: {0}", { 0: p.file }) : p.url,
        extra: {
          Canais: String(d.live.length),
          Filmes: String(d.vod.length),
          Séries: String(d.series.length),
          EPG: epgCandidates(d)[0] ?? "—",
        },
      };
    },
    liveCategories: async () => (await data()).liveCats,
    liveChannels: async (cat) => (await data()).live.filter((c) => !cat || c.categoryId === cat),
    vodCategories: async () => (await data()).vodCats,
    vodItems: async (cat) => (await data()).vod.filter((c) => !cat || c.categoryId === cat),
    vodInfo: async () => ({}),
    seriesCategories: async () => (await data()).seriesCats,
    seriesItems: async (cat) => (await data()).series.filter((c) => !cat || c.categoryId === cat),
    async seriesInfo(item): Promise<SeriesInfo> {
      const s = (await data()).series.find((x) => x.id === item.id);
      const bySeason = new Map<number, Episode[]>();
      for (const e of s?.episodes ?? []) {
        if (!bySeason.has(e.season)) bySeason.set(e.season, []);
        bySeason.get(e.season)!.push(e);
      }
      return {
        seasons: [...bySeason]
          .sort((a, b) => a[0] - b[0])
          .map(([num, episodes]) => ({ num, name: `Temporada ${num}`, episodes: episodes.sort((a, b) => a.num - b.num) })),
      };
    },
    async epg(ch, limit = 8) {
      const now = Date.now();
      return (await progsFor(ch)).filter((x) => x.end > now).slice(0, limit);
    },
    async archive(ch) {
      const now = Date.now();
      return (await progsFor(ch)).filter((x) => x.end < now).reverse();
    },
    async catchupUrl(ch, prog) {
      const info = catchupInfo.get(ch.id) ?? { mode: "default" };
      const start = Math.floor(prog.start / 1000);
      const end = Math.floor(prog.end / 1000);
      const now = Math.floor(Date.now() / 1000);
      const d = new Date(prog.start);
      const z = (n: number) => String(n).padStart(2, "0");
      const fill = (t: string) =>
        t
          .replace(/\{utc\}|\$\{start\}|\{start\}/g, String(start))
          .replace(/\{utcend\}|\$\{end\}|\{end\}/g, String(end))
          .replace(/\{lutc\}|\$\{now\}|\{now\}|\$\{timestamp\}/g, String(now))
          .replace(/\{duration\}|\$\{duration\}/g, String(end - start))
          .replace(/\{offset\}|\$\{offset\}/g, String(now - start))
          .replace(/\{Y\}/g, String(d.getFullYear()))
          .replace(/\{m\}/g, z(d.getMonth() + 1))
          .replace(/\{d\}/g, z(d.getDate()))
          .replace(/\{H\}/g, z(d.getHours()))
          .replace(/\{M\}/g, z(d.getMinutes()))
          .replace(/\{S\}/g, z(d.getSeconds()));
      if (info.source) {
        if (info.mode === "append") return ch.stream + fill(info.source);
        return fill(info.source);
      }
      const sep = ch.stream.includes("?") ? "&" : "?";
      return `${ch.stream}${sep}utc=${start}&lutc=${now}`;
    },
    resolve: async (s) => s,
  };
}
