import { ChevronLeft, ChevronRight, Clapperboard, Film, Info, Play, Plus, RefreshCw, Search, Star, Tv } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChannelLogo, Clock, ImdbBadge, Poster, ProgressBar } from "../components/ui";
import { cleanTitle, getMeta, type Meta } from "../lib/meta";
import { useParental } from "../lib/parental";
import { clearCache, useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { Channel, SeriesItem, VodItem } from "../lib/types";
import { cn, fmtTime, progress } from "../lib/util";
import { resetProviders, useApp, useFavs, useHistory, useProfile, useProvider } from "../store/app";
import { PosterCard, SeriesDetail, VodDetail } from "./Media";

import { t, tn } from "../lib/i18n";
type Featured = { kind: "vod"; item: VodItem; meta: Meta | null } | { kind: "series"; item: SeriesItem; meta: Meta | null };

const greeting = () => {
  const h = new Date().getHours();
  return h < 6 ? t("Boa noite") : h < 13 ? t("Bom dia") : h < 20 ? t("Boa tarde") : t("Boa noite");
};

export function Home() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const nav = useApp((s) => s.nav);
  const hideAdult = useApp((s) => s.settings.hideAdult);
  const metaOn = useApp((s) => s.settings.metadata);
  const [openVod, setOpenVod] = useState<VodItem | null>(null);
  const [openSeries, setOpenSeries] = useState<SeriesItem | null>(null);

  const acc = useQuery(`acc:${profile.id}`, () => provider.account());
  // Stalker catalogues are paginated and slow: don't preload them here
  const cheap = profile.kind !== "stalker";
  const vod = useQuery(cheap ? `vod-items:${profile.id}:all` : null, () => provider.vodItems());
  const series = useQuery(cheap ? `series-items:${profile.id}:all` : null, () => provider.seriesItems());
  const vodCats = useQuery(cheap ? `vod-cats:${profile.id}` : null, () => provider.vodCategories());

  const adultCats = useMemo(() => new Set((vodCats.data ?? []).filter((c) => isAdult(c.name)).map((c) => c.id)), [vodCats.data]);
  const seriesCats = useQuery(cheap ? `series-cats:${profile.id}` : null, () => provider.seriesCategories());
  const parV = useParental("vod", vodCats.data);
  const parS = useParental("series", seriesCats.data);
  const recentVod = useMemo(
    () => (vod.data ?? []).filter((v) => (!hideAdult || !adultCats.has(v.categoryId ?? "")) && !parV.hidden.has(v.categoryId ?? "")).slice(0, 24),
    [vod.data, hideAdult, adultCats, parV.hidden],
  );
  const recentSeries = useMemo(() => (series.data ?? []).filter((v) => !parS.hidden.has(v.categoryId ?? "")).slice(0, 24), [series.data, parS.hidden]);

  const featured = useFeatured(recentVod, recentSeries, metaOn);
  const days = acc.data?.expires ? Math.ceil((acc.data.expires - Date.now()) / 864e5) : null;

  const reload = () => {
    clearCache();
    resetProviders();
    // every query on this screen, not just the account: otherwise the rows keep the old lists
    for (const q of [acc, vod, series, vodCats, seriesCats]) q.refetch();
  };
  const refreshing = [acc, vod, series, vodCats, seriesCats].some((q) => q.loading);

  return (
    <div className="h-full overflow-y-auto">
      {/* top bar */}
      <div className="relative z-20 flex items-center gap-4 px-10 pt-6 pb-8">
        <div className="min-w-0 flex-1">
          <div className="font-display text-2xl font-bold tracking-tight">
            {greeting()}, <span className="text-gradient">{profile.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-sky-100/50">
            <span className={cn("size-1.5 rounded-full", acc.error ? "bg-rose-400" : acc.loading ? "bg-amber-300" : "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400")} />
            {acc.error ? t("Sem ligação ao servidor · {0}", { 0: acc.error }) : acc.loading ? t("A ligar ao servidor…") : days != null ? tn(days, "Subscrição ativa · expira em 1 dia", "Subscrição ativa · expira em {n} dias") : t("Subscrição ativa")}
          </div>
        </div>
        <button onClick={() => nav("search")} className="focusable flex h-11 w-80 items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 text-sm text-sky-100/45 transition hover:border-sky-300/30 hover:bg-white/[0.07]">
          <Search className="size-4" /> {t("Procurar canais, filmes, séries…")}
        </button>
        <button onClick={reload} disabled={refreshing} title={t("Recarregar listas")} className="focusable grid size-11 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-sky-100/70 transition hover:text-white">
          <RefreshCw className={cn("size-[18px]", refreshing && "animate-spin")} />
        </button>
        <Clock />
      </div>

      <div className="-mt-4 px-10 pb-14">
        <Hero
          featured={featured}
          loading={cheap && (vod.loading || (!!recentVod.length && featured.length === 0 && metaOn))}
          onDetails={(f) => (f.kind === "vod" ? setOpenVod(f.item) : setOpenSeries(f.item))}
          onBrowse={() => nav(cheap ? "vod" : "live")}
        />

        <ContinueRow />
        <LiveNowRow />

        {recentVod.length > 0 && (
          <Row title={t("Filmes adicionados")} icon={<Film className="size-4" />} action={{ label: t("Ver todos"), onClick: () => nav("vod") }}>
            {recentVod.map((it) => (
              <div key={it.id} className="w-[158px] shrink-0">
                <PosterCard item={it} kind="vod" onClick={() => setOpenVod(it)} />
              </div>
            ))}
          </Row>
        )}
        {recentSeries.length > 0 && (
          <Row title={t("Séries adicionadas")} icon={<Clapperboard className="size-4" />} action={{ label: t("Ver todas"), onClick: () => nav("series") }}>
            {recentSeries.map((it) => (
              <div key={it.id} className="w-[158px] shrink-0">
                <PosterCard item={it} kind="series" onClick={() => setOpenSeries(it)} />
              </div>
            ))}
          </Row>
        )}
      </div>

      {openVod && <VodDetail item={openVod} onClose={() => setOpenVod(null)} />}
      {openSeries && <SeriesDetail item={openSeries} onClose={() => setOpenSeries(null)} />}
    </div>
  );
}

/** Up to 5 recent titles that have a proper backdrop, for the hero carousel. */
function useFeatured(vod: VodItem[], series: SeriesItem[], enabled: boolean): Featured[] {
  const [list, setList] = useState<Featured[]>([]);
  useEffect(() => {
    let alive = true;
    setList([]);
    const pool: Featured[] = [];
    for (let i = 0; i < 8; i++) {
      if (vod[i]) pool.push({ kind: "vod", item: vod[i], meta: null });
      if (series[i]) pool.push({ kind: "series", item: series[i], meta: null });
    }
    if (!enabled) {
      setList(pool.slice(0, 5));
      return;
    }
    (async () => {
      const out: Featured[] = [];
      for (const f of pool) {
        if (out.length >= 5) break;
        const m = await getMeta(f.kind === "vod" ? "movie" : "series", f.item.name, f.item.year).catch(() => null);
        if (!alive) return;
        if (m?.backdrop && m.confident) {
          out.push({ ...f, meta: m } as Featured);
          setList([...out]);
        }
      }
      // nothing matched online: still show something
      if (!out.length && alive) setList(pool.slice(0, 3));
    })();
    return () => {
      alive = false;
    };
  }, [vod, series, enabled]);
  return list;
}

function Hero({ featured, loading, onDetails, onBrowse }: { featured: Featured[]; loading: boolean; onDetails: (f: Featured) => void; onBrowse: () => void }) {
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const favs = useFavs();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => setI(0), [featured.length === 0]);
  useEffect(() => {
    if (featured.length < 2 || paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % featured.length), 9000);
    return () => clearInterval(t);
  }, [featured.length, paused]);

  if (loading && !featured.length) return <div className="skeleton mb-10 h-[min(52vh,520px)] rounded-[28px]" />;

  if (!featured.length)
    return (
      <div className="relative mb-10 flex h-[min(44vh,420px)] items-end overflow-hidden rounded-[28px] border border-white/[0.06] bg-ink-800 p-10">
        <StormArt />
        <div className="relative max-w-xl">
          <div className="mb-2 text-xs font-bold tracking-[0.25em] text-sky-300 uppercase">{t("HurricaneTV")}</div>
          <h1 className="text-5xl font-bold">{t("Tudo o que vês, num só lugar.")}</h1>
          <p className="mt-3 text-sky-100/60">{t("Canais em direto, guia de programação, filmes e séries da tua lista.")}</p>
          <div className="mt-6 flex gap-3">
            <HeroBtn primary onClick={onBrowse} icon={<Tv className="size-5" />}>
              {t("Explorar")}
            </HeroBtn>
          </div>
        </div>
      </div>
    );

  const f = featured[Math.min(i, featured.length - 1)];
  const m = f.meta;
  const title = m?.title ?? cleanTitle(f.item.name).title;
  const isFav = f.kind === "vod" ? favs.vod.some((x) => x.id === f.item.id) : favs.series.some((x) => x.id === f.item.id);
  const watch = () => {
    if (f.kind === "vod") play({ title, stream: f.item.stream, type: "vod", poster: m?.poster ?? f.item.poster, ua: f.item.ua, referer: f.item.referer });
    else onDetails(f);
  };

  return (
    <section
      className="relative mb-10 h-[min(52vh,520px)] overflow-hidden rounded-[28px] border border-white/[0.06] bg-ink-800 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {m?.backdrop ? (
        <img key={m.backdrop} src={m.backdrop} alt="" className="absolute inset-0 size-full scale-[1.02] object-cover animate-fade-up" draggable={false} />
      ) : (
        <StormArt />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-transparent" />

      <div key={f.item.id} className="relative flex h-full max-w-[620px] flex-col justify-end p-10 animate-fade-up">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-[0.22em] text-sky-300 uppercase">
          {f.kind === "vod" ? <Film className="size-3.5" /> : <Clapperboard className="size-3.5" />}
          {f.kind === "vod" ? t("Filme em destaque") : t("Série em destaque")}
        </div>
        {m?.logo ? (
          <img src={m.logo} alt={title} className="mb-4 max-h-28 max-w-[420px] object-contain object-left drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <h1 className="mb-3 text-5xl leading-[1.05] font-bold">{title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-sky-100/75">
          {m?.imdbRating ? <ImdbBadge value={m.imdbRating} size="lg" /> : null}
          {(m?.year || f.item.year) && <span>{(m?.year || f.item.year)!.slice(0, 4)}</span>}
          {m?.runtime && <Dot>{m.runtime}</Dot>}
          {m?.genres.slice(0, 3).map((g) => <Dot key={g}>{g}</Dot>)}
        </div>
        {m?.plot && <p className="mt-4 line-clamp-3 text-[15px] leading-relaxed text-sky-50/75">{m.plot}</p>}
        <div className="mt-6 flex gap-3">
          <HeroBtn primary onClick={watch} icon={<Play className="size-5 fill-current" />}>
            {f.kind === "vod" ? t("Ver agora") : t("Ver episódios")}
          </HeroBtn>
          <HeroBtn onClick={() => onDetails(f)} icon={<Info className="size-5" />}>
            {t("Detalhes")}
          </HeroBtn>
          <button
            onClick={() => toggleFav(f.kind, f.item)}
            title={t("Favorito")}
            className={cn("focusable grid size-12 place-items-center rounded-2xl border backdrop-blur transition", isFav ? "border-amber-300/40 bg-amber-300/15 text-amber-300" : "border-white/15 bg-white/[0.08] hover:bg-white/15")}
          >
            {isFav ? <Star className="size-5 fill-current" /> : <Plus className="size-5" />}
          </button>
        </div>
      </div>

      {featured.length > 1 && (
        <div className="absolute right-8 bottom-8 flex gap-2">
          {featured.map((x, k) => (
            <button key={x.item.id} onClick={() => setI(k)} aria-label={t("Destaque {0}", { 0: k + 1 })} className={cn("h-1.5 rounded-full transition-all", k === i ? "bg-storm w-8" : "w-3 bg-white/25 hover:bg-white/50")} />
          ))}
        </div>
      )}
    </section>
  );
}

function StormArt() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute -top-1/3 right-0 size-[620px] rounded-full bg-sky-400/25 blur-[110px]" />
      <div className="absolute -right-24 -bottom-1/2 size-[640px] rounded-full bg-blue-600/35 blur-[120px]" />
      <img src="/brand-mark.png" alt="" className="absolute top-1/2 right-[6%] size-[400px] -translate-y-1/2 object-contain opacity-[0.16] blur-[1px]" draggable={false} />
    </div>
  );
}

const Dot = ({ children }: { children: ReactNode }) => (
  <span className="flex items-center gap-3">
    <span className="size-1 rounded-full bg-sky-100/35" />
    {children}
  </span>
);

function HeroBtn({ children, onClick, icon, primary }: { children: ReactNode; onClick: () => void; icon: ReactNode; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "focusable inline-flex h-12 items-center gap-2.5 rounded-2xl px-6 text-[15px] font-bold transition",
        primary ? "bg-storm text-ink-950 shadow-[0_12px_40px_-10px_rgba(34,225,255,0.6)] hover:brightness-110" : "border border-white/15 bg-white/[0.08] backdrop-blur hover:bg-white/15",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------------- rows ---------------- */

function Row({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="group/row mb-9">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-white/[0.06] text-sky-300">{icon}</span>
        <h2 className="text-lg font-bold">{title}</h2>
        {action && (
          <button onClick={action.onClick} className="focusable ml-2 rounded-lg px-2 py-1 text-xs font-semibold text-sky-100/45 transition hover:text-sky-300">
            {action.label} →
          </button>
        )}
        <div className="ml-auto flex gap-1.5 opacity-0 transition group-hover/row:opacity-100">
          <button onClick={() => scroll(-1)} className="grid size-8 place-items-center rounded-lg bg-white/[0.06] hover:bg-white/15">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => scroll(1)} className="grid size-8 place-items-center rounded-lg bg-white/[0.06] hover:bg-white/15">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div ref={ref} className="-mx-2 flex gap-4 overflow-x-auto px-2 pt-1 pb-3 [scrollbar-width:none]">
        {children}
      </div>
    </section>
  );
}

function ContinueRow() {
  const play = useApp((s) => s.play);
  const items = useHistory().filter((h) => (h.play.type === "vod" || h.play.type === "episode") && h.position && h.duration && h.position / h.duration < 0.95);
  if (!items.length) return null;
  return (
    <Row title={t("Continuar a ver")} icon={<Play className="size-4" />}>
      {items.slice(0, 15).map((h) => (
        <button key={h.key} onClick={() => play(h.play)} className="focusable group w-[300px] shrink-0 rounded-2xl text-left">
          <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/[0.08] transition group-hover:ring-sky-300/50">
            <Poster src={h.poster} name={h.title} className="aspect-video" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
            <div className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="bg-storm grid size-14 place-items-center rounded-full text-ink-950 shadow-xl">
                <Play className="ml-0.5 size-6 fill-current" />
              </span>
            </div>
            <div className="absolute inset-x-3 bottom-3">
              <div className="truncate text-sm font-bold">{h.title}</div>
              {h.play.subtitle && h.play.subtitle !== h.title && <div className="truncate text-xs text-sky-100/60">{h.play.subtitle}</div>}
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
                <div className="bg-storm h-full rounded-full" style={{ width: `${(h.position! / h.duration!) * 100}%` }} />
              </div>
            </div>
          </div>
        </button>
      ))}
    </Row>
  );
}

function LiveNowRow() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const favs = useFavs();
  const nav = useApp((s) => s.nav);
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());
  const cats = useQuery(`live-cats:${profile.id}`, () => provider.liveCategories());
  const par = useParental("live", cats.data);
  const channels = useMemo(
    () => (favs.live.length ? favs.live : (all.data ?? []).filter((c) => !c.isRadio).slice(0, 16)).filter((c) => !par.hidden.has(c.categoryId ?? "")),
    [favs.live, all.data, par.hidden],
  );
  if (!channels.length) return null;
  return (
    <Row title={favs.live.length ? t("Os teus canais, agora") : t("A dar agora")} icon={<Tv className="size-4" />} action={{ label: t("Guia TV"), onClick: () => nav("epg") }}>
      {channels.map((c, i) => (
        <LiveCard key={c.id} ch={c} list={channels} index={i} />
      ))}
    </Row>
  );
}

function LiveCard({ ch, list, index }: { ch: Channel; list: Channel[]; index: number }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const h24 = useApp((s) => s.settings.timeFormat24);
  const epg = useQuery(`epg:${ch.id}`, () => provider.epg(ch, 3));
  const now = Date.now();
  const cur = epg.data?.find((p) => p.start <= now && p.end > now);
  return (
    <button
      onClick={() => play({ title: ch.name, stream: ch.stream, type: "live", channels: list, index, poster: ch.logo, ua: ch.ua, referer: ch.referer })}
      className="focusable group flex w-[280px] shrink-0 flex-col gap-3 rounded-2xl border border-white/[0.06] bg-ink-800/80 p-4 text-left transition hover:-translate-y-0.5 hover:border-sky-300/30 hover:bg-ink-700/80"
    >
      <div className="flex items-center gap-3">
        <ChannelLogo src={ch.logo} name={ch.name} className="size-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{ch.name}</div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-400" /> {t("Em direto")}
          </div>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-sky-100/60 transition group-hover:bg-sky-400 group-hover:text-ink-950">
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
      </div>
      {cur ? (
        <div>
          <div className="truncate text-[13px] text-sky-50/85">{cur.title}</div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-sky-100/40 tabular-nums">
            {fmtTime(cur.start, h24)}
            <ProgressBar value={progress(cur)} className="flex-1" />
            {fmtTime(cur.end, h24)}
          </div>
        </div>
      ) : (
        <div className="text-[13px] text-sky-100/35">{epg.loading ? "…" : t("Sem informação de programação")}</div>
      )}
    </button>
  );
}
