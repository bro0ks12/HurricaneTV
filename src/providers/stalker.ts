import { httpGet } from "../lib/http";
import type { Category, Channel, Episode, Profile, Program, Provider, SeriesInfo, SeriesItem, VodItem } from "../lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export const STALKER_UA =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3";

export function normalizeMac(mac: string) {
  const hex = mac.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return hex.match(/.{1,2}/g)?.join(":") ?? mac.toUpperCase();
}

function endpoints(portal: string): string[] {
  let p = portal.trim();
  if (!/^https?:\/\//i.test(p)) p = "http://" + p;
  const u = new URL(p);
  const root = `${u.protocol}//${u.host}`;
  const path = u.pathname.replace(/\/+$/, "");
  const list: string[] = [];
  if (/\.php$/.test(path)) list.push(root + path);
  if (path.endsWith("/c")) list.push(root + path.slice(0, -2) + "/portal.php", root + path.slice(0, -2) + "/server/load.php");
  list.push(
    root + "/portal.php",
    root + "/stalker_portal/server/load.php",
    root + "/c/portal.php",
    root + path + "/portal.php",
    root + path + "/server/load.php",
  );
  return [...new Set(list)];
}

/** Strip "ffmpeg " / "auto " prefixes stalker puts in cmd fields */
const cleanCmd = (cmd: string) => cmd.replace(/^(ffmpeg|auto|ffrt\d?)\s+/i, "").trim();

export function createStalker(p: Profile): Provider {
  const mac = normalizeMac(p.mac!);
  let endpoint: string | null = null;
  let token = "";
  let ready: Promise<void> | null = null;

  const headers = () => ({
    "User-Agent": STALKER_UA,
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Cookie: `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
    Referer: p.portal!,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const raw = async (ep: string, params: Record<string, string | number>) => {
    const qs = Object.entries({ ...params, JsHttpRequest: "1-xml" })
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    const r = await httpGet(`${ep}?${qs}`, headers());
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    return j?.js;
  };

  const connect = async () => {
    let lastErr: unknown = new Error("Portal não encontrado");
    for (const ep of endpoints(p.portal!)) {
      try {
        token = "";
        const js = await raw(ep, { type: "stb", action: "handshake", token: "" });
        if (js?.token) {
          token = js.token;
          endpoint = ep;
          await raw(ep, { type: "stb", action: "get_profile", hd: 1, ver: "ImageDescription: 0.2.18-r23-250; PORTAL version: 5.6.1", num_banks: 2, stb_type: "MAG250", image_version: 218, auth_second_step: 1, hw_version: "1.7-BD-00", not_valid_token: 0, device_id: "", device_id2: "", signature: "" }).catch(() => null);
          return;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  const call = async (params: Record<string, string | number>) => {
    await (ready ??= connect().catch((e) => {
      ready = null;
      throw e;
    }));
    return raw(endpoint!, params);
  };

  const cats = async (type: string, action = "get_categories"): Promise<Category[]> => {
    const js = await call({ type, action });
    return (Array.isArray(js) ? js : [])
      .filter((c: Any) => c.id !== "*")
      .map((c: Any) => ({ id: String(c.id), name: c.title || c.name }));
  };

  // stalker vod lists are paginated
  const paged = async (params: Record<string, string | number>, max = 15): Promise<Any[]> => {
    const out: Any[] = [];
    for (let page = 1; page <= max; page++) {
      const js = await call({ ...params, p: page });
      const data: Any[] = js?.data ?? [];
      out.push(...data);
      const total = Number(js?.total_items ?? 0);
      if (!data.length || out.length >= total) break;
    }
    return out;
  };

  let allChannels: Promise<Channel[]> | null = null;

  return {
    kind: "stalker",
    async account() {
      const js = await call({ type: "account_info", action: "get_main_info" }).catch(() => null);
      const exp = js?.end_date || js?.phone;
      const t = exp ? Date.parse(exp) : NaN;
      return {
        status: "Active",
        expires: Number.isFinite(t) ? t : null,
        serverUrl: endpoint ?? p.portal,
        extra: { MAC: mac, ...(js?.tariff_plan ? { Plano: js.tariff_plan } : {}) },
      };
    },
    liveCategories: () => cats("itv", "get_genres"),
    async liveChannels(categoryId) {
      allChannels ??= call({ type: "itv", action: "get_all_channels" }).then((js) =>
        (js?.data ?? []).map(
          (c: Any): Channel => ({
            id: String(c.id),
            num: Number(c.number) || undefined,
            name: c.name,
            logo: c.logo || undefined,
            categoryId: String(c.tv_genre_id),
            epgId: c.xmltv_id || undefined,
            catchup: c.tv_archive == 1 || c.allow_pvr == 1,
            catchupDays: Number(c.tv_archive_duration) / 24 || undefined,
            stream: c.cmd,
          }),
        ),
      );
      const list = await allChannels;
      return categoryId ? list.filter((c) => c.categoryId === categoryId) : list;
    },
    vodCategories: () => cats("vod"),
    async vodItems(categoryId) {
      const data = await paged({ type: "vod", action: "get_ordered_list", category: categoryId ?? "*", sortby: "added" });
      return data
        .filter((v) => v.is_series != 1)
        .map(
          (v): VodItem => ({
            id: String(v.id),
            name: v.name,
            poster: v.screenshot_uri || undefined,
            categoryId: String(v.category_id),
            rating: Number(v.rating_imdb) || undefined,
            year: v.year || undefined,
            stream: v.cmd,
          }),
        );
    },
    async vodInfo() {
      return {};
    },
    seriesCategories: () => cats("series"),
    async seriesItems(categoryId) {
      const data = await paged({ type: "series", action: "get_ordered_list", category: categoryId ?? "*", sortby: "added" });
      return data.map(
        (v): SeriesItem => ({
          id: String(v.id),
          name: v.name,
          poster: v.screenshot_uri || undefined,
          categoryId: String(v.category_id),
          rating: Number(v.rating_imdb) || undefined,
          year: v.year || undefined,
          plot: v.description,
        }),
      );
    },
    async seriesInfo(item): Promise<SeriesInfo> {
      const data = await paged({ type: "series", action: "get_ordered_list", movie_id: item.id, season_id: 0, episode_id: 0 }, 5);
      return {
        plot: item.plot,
        seasons: data.map((s, i) => {
          const sn = Number(String(s.name).match(/\d+/)?.[0]) || i + 1;
          const eps: number[] = Array.isArray(s.series) ? s.series : [];
          return {
            num: sn,
            name: s.name || `Temporada ${sn}`,
            episodes: eps.map(
              (n): Episode => ({
                id: `${s.id}:${n}`,
                num: Number(n),
                season: sn,
                title: `Episódio ${n}`,
                image: s.screenshot_uri || item.poster,
                stream: JSON.stringify({ cmd: s.cmd, series: n }),
              }),
            ),
          };
        }),
      };
    },
    async epg(ch, limit = 8) {
      const js = await call({ type: "itv", action: "get_short_epg", ch_id: ch.id, size: limit });
      return (Array.isArray(js) ? js : []).map(
        (e: Any): Program => ({
          title: e.name,
          description: e.descr,
          start: Number(e.start_timestamp) * 1000,
          end: Number(e.stop_timestamp) * 1000,
        }),
      );
    },
    async resolve(stream, type) {
      if (type === "live") {
        const js = await call({ type: "itv", action: "create_link", cmd: stream, series: "", forced_storage: "undefined", disable_ad: 0, download: 0 });
        return cleanCmd(js?.cmd ?? stream);
      }
      if (type === "episode") {
        const { cmd, series } = JSON.parse(stream);
        const js = await call({ type: "vod", action: "create_link", cmd, series });
        return cleanCmd(js?.cmd ?? cmd);
      }
      const js = await call({ type: "vod", action: "create_link", cmd: stream, series: "" });
      return cleanCmd(js?.cmd ?? stream);
    },
  };
}
