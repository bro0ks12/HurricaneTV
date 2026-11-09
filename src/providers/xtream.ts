import { t } from "../lib/i18n";
import { httpJson } from "../lib/http";
import { getSettings } from "../lib/settings";
import type { AccountInfo, Category, Channel, Episode, Profile, Program, Provider, SeriesInfo, SeriesItem, VodInfo, VodItem } from "../lib/types";
import { b64 } from "../lib/util";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = "http://" + v;
  return v.replace(/\/(player_api\.php|get\.php).*$/i, "");
}

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function createXtream(p: Profile): Provider {
  const base = normalizeServer(p.server!);
  const u = encodeURIComponent(p.username!);
  const pw = encodeURIComponent(p.password!);
  const api = (action?: string, params: Record<string, string | number> = {}) => {
    let url = `${base}/player_api.php?username=${u}&password=${pw}`;
    if (action) url += `&action=${action}`;
    for (const [k, v] of Object.entries(params)) url += `&${k}=${encodeURIComponent(String(v))}`;
    return httpJson<Any>(url);
  };
  const cats = async (action: string): Promise<Category[]> => {
    const r = await api(action);
    return (Array.isArray(r) ? r : []).map((c: Any) => ({ id: String(c.category_id), name: c.category_name }));
  };
  const parseEpg = (list: Any[]): Program[] =>
    (list || []).map((e: Any) => ({
      title: b64(e.title),
      description: b64(e.description),
      start: Number(e.start_timestamp) * 1000,
      end: Number(e.stop_timestamp ?? e.end_timestamp) * 1000,
      hasArchive: e.has_archive == 1,
      startRaw: e.start,
    }));
  /** unix seconds (string or number) -> ms, undefined when missing */
  const ts = (v: Any) => (Number(v) > 0 ? Number(v) * 1000 : undefined);
  const rating = (s: Any) => {
    const r5 = num(s.rating_5based);
    return r5 ? r5 * 2 : num(s.rating);
  };

  return {
    kind: "xtream",
    async account(): Promise<AccountInfo> {
      const r = await api();
      const ui = r?.user_info;
      if (!ui || ui.auth === 0) throw new Error(t("Credenciais inválidas"));
      return {
        status: ui.status,
        // some panels send "0" (a truthy string) for unlimited accounts
        expires: Number(ui.exp_date) > 0 ? Number(ui.exp_date) * 1000 : null,
        maxConnections: num(ui.max_connections),
        activeConnections: num(ui.active_cons),
        createdAt: Number(ui.created_at) > 0 ? Number(ui.created_at) * 1000 : undefined,
        isTrial: ui.is_trial == 1,
        serverUrl: base,
        timezone: r?.server_info?.timezone,
      };
    },
    liveCategories: () => cats("get_live_categories"),
    async liveChannels(categoryId) {
      const r = await api("get_live_streams", categoryId ? { category_id: categoryId } : {});
      return (Array.isArray(r) ? r : []).map(
        (s: Any): Channel => ({
          id: String(s.stream_id),
          num: num(s.num),
          name: s.name,
          logo: s.stream_icon || undefined,
          categoryId: String(s.category_id),
          epgId: s.epg_channel_id || undefined,
          catchup: s.tv_archive == 1,
          catchupDays: num(s.tv_archive_duration),
          isRadio: s.stream_type === "radio_streams",
          stream: `${base}/live/${u}/${pw}/${s.stream_id}.ts`,
        }),
      );
    },
    vodCategories: () => cats("get_vod_categories"),
    async vodItems(categoryId) {
      const r = await api("get_vod_streams", categoryId ? { category_id: categoryId } : {});
      return (Array.isArray(r) ? r : []).map(
        (s: Any): VodItem => ({
          id: String(s.stream_id),
          name: s.name,
          poster: s.stream_icon || undefined,
          categoryId: String(s.category_id),
          rating: rating(s),
          year: s.year || undefined,
          added: ts(s.added),
          ext: s.container_extension,
          stream: `${base}/movie/${u}/${pw}/${s.stream_id}.${s.container_extension || "mp4"}`,
        }),
      );
    },
    async vodInfo(item): Promise<VodInfo> {
      const r = await api("get_vod_info", { vod_id: item.id });
      const i = r?.info ?? {};
      return {
        plot: i.plot || i.description,
        genre: i.genre,
        cast: i.cast || i.actors,
        director: i.director,
        duration: i.duration,
        backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path,
        trailer: i.youtube_trailer,
        releaseDate: i.releasedate || i.release_date,
      };
    },
    seriesCategories: () => cats("get_series_categories"),
    async seriesItems(categoryId) {
      const r = await api("get_series", categoryId ? { category_id: categoryId } : {});
      return (Array.isArray(r) ? r : []).map(
        (s: Any): SeriesItem => ({
          id: String(s.series_id),
          name: s.name,
          poster: s.cover || undefined,
          categoryId: String(s.category_id),
          rating: rating(s),
          year: String(s.releaseDate || s.release_date || "").slice(0, 4) || undefined,
          plot: s.plot,
          added: ts(s.last_modified || s.added),
        }),
      );
    },
    async seriesInfo(item): Promise<SeriesInfo> {
      const r = await api("get_series_info", { series_id: item.id });
      const i = r?.info ?? {};
      const eps = r?.episodes ?? {};
      const seasonsMeta: Any[] = Array.isArray(r?.seasons) ? r.seasons : [];
      const seasons = Object.keys(eps)
        .map(Number)
        .sort((a, b) => a - b)
        .map((sn) => ({
          num: sn,
          name: seasonsMeta.find((s) => Number(s.season_number) === sn)?.name || `Temporada ${sn}`,
          episodes: ((eps[sn] ?? eps[String(sn)]) as Any[]).map(
            (e): Episode => ({
              id: String(e.id),
              num: Number(e.episode_num),
              season: sn,
              title: e.title,
              plot: e.info?.plot,
              image: e.info?.movie_image,
              duration: e.info?.duration,
              stream: `${base}/series/${u}/${pw}/${e.id}.${e.container_extension || "mp4"}`,
            }),
          ),
        }));
      return {
        plot: i.plot,
        genre: i.genre,
        cast: i.cast,
        backdrop: Array.isArray(i.backdrop_path) ? i.backdrop_path[0] : i.backdrop_path,
        seasons,
      };
    },
    async epg(ch, limit = 8) {
      const r = await api("get_short_epg", { stream_id: ch.id, limit });
      return parseEpg(r?.epg_listings);
    },
    async archive(ch) {
      const r = await api("get_simple_data_table", { stream_id: ch.id });
      const now = Date.now();
      return parseEpg(r?.epg_listings)
        .filter((e) => e.end < now && e.hasArchive)
        .reverse();
    },
    async catchupUrl(ch, prog) {
      const dur = Math.max(1, Math.round((prog.end - prog.start) / 60000));
      let start: string;
      if (prog.startRaw && prog.startRaw.includes(" ")) {
        // "2024-05-01 21:00:00" -> "2024-05-01:21-00" (server-local time)
        const [d, t] = prog.startRaw.split(" ");
        start = `${d}:${t.slice(0, 5).replace(":", "-")}`;
      } else {
        const d = new Date(prog.start);
        const z = (n: number) => String(n).padStart(2, "0");
        start = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}:${z(d.getHours())}-${z(d.getMinutes())}`;
      }
      return `${base}/timeshift/${u}/${pw}/${dur}/${start}/${ch.id}.ts`;
    },
    async resolve(stream, type) {
      if (type === "live" && getSettings().liveFormat === "m3u8") return stream.replace(/\.ts$/, ".m3u8");
      return stream;
    },
  };
}
