import { httpText } from "../lib/http";
import type { Category, Channel, Episode, Profile, Program, Provider, SeriesInfo, SeriesItem, VodItem } from "../lib/types";

interface Entry {
  name: string;
  attrs: Record<string, string>;
  url: string;
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
      cur = { name, attrs };
    } else if (line.startsWith("#EXTGRP:") && cur) {
      cur.attrs["group-title"] ||= line.slice(8).trim();
    } else if (!line.startsWith("#") && cur) {
      entries.push({ ...cur, url: line });
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

function build(text: string): Parsed {
  const { header, entries } = parseM3u(text);
  const live: Channel[] = [];
  const vod: VodItem[] = [];
  const seriesMap = new Map<string, SeriesItem & { episodes: Episode[] }>();
  let n = 0;
  entries.forEach((e, idx) => {
    const group = e.attrs["group-title"] || "Sem categoria";
    const logo = e.attrs["tvg-logo"] || undefined;
    const isSeries = /\/series\//i.test(e.url) || (VOD_EXT.test(e.url) && EP.test(e.name));
    const isVod = !isSeries && (/\/movie\//i.test(e.url) || VOD_EXT.test(e.url));
    if (isSeries) {
      const m = e.name.match(EP);
      const title = (m?.[1] || e.name).replace(/[\s._-]+$/, "").trim() || e.name;
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
      });
    } else if (isVod) {
      vod.push({ id: String(idx), name: e.name, poster: logo, categoryId: group, stream: e.url });
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
  for (const list of out.values()) list.sort((a, b) => a.start - b.start);
  return out;
}

/* ---------------- Provider ---------------- */

export function createM3u(p: Profile): Provider {
  let parsed: Promise<Parsed> | null = null;
  let epg: Promise<Map<string, Program[]>> | null = null;
  const data = () => (parsed ??= httpText(p.url!).then(build));
  const guide = async () => {
    const d = await data();
    const url = p.epgUrl || d.epgUrl?.split(",")[0];
    if (!url) return new Map<string, Program[]>();
    const wanted = new Set(d.live.map((c) => c.epgId?.toLowerCase()).filter(Boolean) as string[]);
    return (epg ??= loadXmltv(url, wanted).catch(() => new Map<string, Program[]>()));
  };
  const progsFor = async (ch: Channel) => (ch.epgId ? (await guide()).get(ch.epgId.toLowerCase()) ?? [] : []);

  return {
    kind: "m3u",
    async account() {
      const d = await data();
      return {
        status: "Active",
        expires: null,
        serverUrl: p.url,
        extra: {
          Canais: String(d.live.length),
          Filmes: String(d.vod.length),
          Séries: String(d.series.length),
          EPG: p.epgUrl || d.epgUrl || "—",
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
