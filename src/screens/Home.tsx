import { ChevronLeft, ChevronRight, Clapperboard, Film, History, Info, Play, Plus, RefreshCw, Search, Star, Tv } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChannelLogo, ImdbBadge, Poster } from "../components/ui";
import { cleanTitle, genreName, getMeta, type Meta } from "../lib/meta";
import { useParental } from "../lib/parental";
import { clearCache, useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { Channel, SeriesItem, VodItem } from "../lib/types";
import { cn, fmtTime } from "../lib/util";
import { resetProviders, useApp, useFavs, useHistory, useProfile, useProvider, type HistoryEntry } from "../store/app";
import { PosterCard, SeriesDetail, VodDetail } from "./Media";

import { t } from "../lib/i18n";
type Featured = { kind: "vod"; item: VodItem; meta: Meta | null } | { kind: "series"; item: SeriesItem; meta: Meta | null };

export function Home() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const nav = useApp((s) => s.nav);
  const play = useApp((s) => s.play);
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

  const reload = () => {
    clearCache();
    resetProviders();
    // every query on this screen, not just the account: otherwise the rows keep the old lists
    for (const q of [acc, vod, series, vodCats, seriesCats]) q.refetch();
  };
  const refreshing = [acc, vod, series, vodCats, seriesCats].some((q) => q.loading);

  // hero: what you were watching (hover/focus a card to preview it), else rotating featured titles
  const history = useHistory();
  const resumable = useMemo(
    () => history.filter((h) => (h.play.type === "vod" || h.play.type === "episode") && !(h.position && h.duration && h.position / h.duration >= 0.95)).slice(0, 15),
    [history],
  );
  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = resumable.find((h) => h.key === selKey) ?? resumable[0] ?? null;
  const selMeta = useHistoryMeta(sel, metaOn);
  const [fi, setFi] = useState(0);
  const feat = featured[Math.min(fi, Math.max(featured.length - 1, 0))] as Featured | undefined;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(i);
  }, []);
  const h24 = useApp((s) => s.settings.timeFormat24);
  const left = sel?.duration && sel.position ? sel.duration - sel.position : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="relative">
        <HeroBackdrop src={sel ? selMeta?.backdrop : feat?.meta?.backdrop} />

        {/* top-right tools */}
        <div className="absolute top-5 right-10 z-20 flex items-start gap-2">
          <button onClick={() => nav("search")} title={t("Procurar canais, filmes, séries…")} className="focusable grid size-10 place-items-center rounded-xl border border-white/10 bg-black/35 text-sky-100/80 backdrop-blur transition hover:text-white">
            <Search className="size-[17px]" />
          </button>
          <button onClick={reload} disabled={refreshing} title={acc.error ? t("Sem ligação ao servidor · {0}", { 0: acc.error }) : t("Recarregar listas")} className="focusable relative grid size-10 place-items-center rounded-xl border border-white/10 bg-black/35 text-sky-100/80 backdrop-blur transition hover:text-white">
            <RefreshCw className={cn("size-[17px]", refreshing && "animate-spin")} />
            {acc.error && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-rose-400" />}
          </button>
          <div className="rounded-xl border border-white/10 bg-black/35 px-3.5 py-1 text-right leading-tight backdrop-blur">
            <div className="text-base font-semibold tabular-nums">{fmtTime(now, h24)}</div>
            {left != null && <div className="text-[10px] text-sky-100/60 tabular-nums">{t("Termina às {0}", { 0: fmtTime(now + left * 1000, h24) })}</div>}
          </div>
        </div>

        <div className="relative z-10 px-10">
          {sel ? (
            <ResumeHero key={sel.key} h={sel} meta={selMeta} onResume={() => play(sel.play)} />
          ) : (
            <FeaturedHero
              featured={featured}
              index={fi}
              setIndex={setFi}
              loading={cheap && (vod.loading || (!!recentVod.length && featured.length === 0 && metaOn))}
              onDetails={(f) => (f.kind === "vod" ? setOpenVod(f.item) : setOpenSeries(f.item))}
              onBrowse={() => nav(cheap ? "vod" : "live")}
            />
          )}

          <ContinueRow items={resumable} selKey={sel?.key ?? null} onSelect={setSelKey} />
        </div>
      </div>

      <div className="relative z-10 px-10 pb-14">
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

/** Metadata (backdrop, logo, plot…) for the history entry shown in the hero. */
function useHistoryMeta(h: HistoryEntry | null, enabled: boolean): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(null);
  const key = h?.key;
  useEffect(() => {
    setMeta(null);
    if (!h || !enabled) return;
    let alive = true;
    getMeta(h.play.type === "episode" ? "series" : "movie", h.title)
      .then((m) => alive && setMeta(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return meta;
}

/* ---------------- hero ---------------- */

/** Full-bleed backdrop that fades into the page background. */
function HeroBackdrop({ src }: { src?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[calc(min(34vh,300px)+240px)] overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
      {src ? <img key={src} src={src} alt="" className="absolute inset-0 size-full object-cover object-top animate-fade-up" draggable={false} /> : <StormArt />}
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950/95 via-ink-950/60 to-ink-950/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/80 via-ink-950/30 to-transparent" />
    </div>
  );
}

const fmtLeft = (sec: number) => {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-lg border border-white/15 bg-black/35 px-3 py-1 text-[13px] font-medium text-sky-50/90 backdrop-blur">{children}</span>;

function HeroShell({ children }: { children: ReactNode }) {
  return <section className="flex min-h-[min(34vh,300px)] pt-14 max-w-[760px] flex-col justify-end pb-4 animate-fade-up">{children}</section>;
}

function TitleBlock({ title, logo }: { title: string; logo?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [logo]);
  return logo && !bad ? (
    <img src={logo} alt={title} className="mb-3 max-h-20 max-w-[340px] object-contain object-left drop-shadow-[0_8px_30px_rgba(0,0,0,0.6)]" onError={() => setBad(true)} />
  ) : (
    <h1 className="mb-3 text-4xl leading-[1.05] font-bold drop-shadow-[0_4px_24px_rgba(0,0,0,0.7)]">{title}</h1>
  );
}

function ResumeHero({ h, meta: m, onResume }: { h: HistoryEntry; meta: Meta | null; onResume: () => void }) {
  const title = m?.title ?? cleanTitle(h.title).title;
  return (
    <HeroShell>
      <TitleBlock title={title} logo={m?.logo} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {m?.year && <Chip>{m.year.slice(0, 4)}</Chip>}
        {m?.genres.length ? <Chip>{m.genres.slice(0, 3).map(genreName).join(", ")}</Chip> : null}
        {m?.runtime && <Chip>{m.runtime}</Chip>}
        {m?.imdbRating ? (
          <Chip>
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-current text-amber-300" /> {m.imdbRating.toFixed(1)}
            </span>
          </Chip>
        ) : null}
        {h.play.subtitle && <Chip>{h.play.subtitle}</Chip>}
      </div>
      {h.position && h.duration ? (
        <div className="mb-3 flex items-center gap-3 text-sm text-sky-100/70">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-white/20">
            <div className="bg-storm h-full rounded-full" style={{ width: `${(h.position / h.duration) * 100}%` }} />
          </div>
          {t("Falta {0}", { 0: fmtLeft(h.duration - h.position) })}
        </div>
      ) : null}
      {m?.plot && <p className="line-clamp-2 max-w-[640px] text-[15px] leading-relaxed text-sky-50/80">{m.plot}</p>}
      <div className="mt-5">
        <HeroBtn primary onClick={onResume} icon={<Play className="size-5 fill-current" />}>
          {t("Retomar")}
        </HeroBtn>
      </div>
    </HeroShell>
  );
}

function FeaturedHero({
  featured,
  index: i,
  setIndex: setI,
  loading,
  onDetails,
  onBrowse,
}: {
  featured: Featured[];
  index: number;
  setIndex: (i: number) => void;
  loading: boolean;
  onDetails: (f: Featured) => void;
  onBrowse: () => void;
}) {
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const favs = useFavs();
  const [paused, setPaused] = useState(false);

  useEffect(() => setI(0), [featured.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (featured.length < 2 || paused) return;
    const t = setInterval(() => setI((i + 1) % featured.length), 9000);
    return () => clearInterval(t);
  }, [featured.length, paused, i, setI]);

  if (loading && !featured.length) return <div className="min-h-[min(34vh,300px)] pt-14" />;

  if (!featured.length)
    return (
      <HeroShell>
        <div className="mb-2 text-xs font-bold tracking-[0.25em] text-sky-300 uppercase">{t("HurricaneTV")}</div>
        <h1 className="text-5xl font-bold">{t("Tudo o que vês, num só lugar.")}</h1>
        <p className="mt-3 text-sky-100/60">{t("Canais em direto, guia de programação, filmes e séries da tua lista.")}</p>
        <div className="mt-6 flex gap-3">
          <HeroBtn primary onClick={onBrowse} icon={<Tv className="size-5" />}>
            {t("Explorar")}
          </HeroBtn>
        </div>
      </HeroShell>
    );

  const f = featured[Math.min(i, featured.length - 1)];
  const m = f.meta;
  const title = m?.title ?? cleanTitle(f.item.name).title;
  const isFav = f.kind === "vod" ? favs.vod.some((x) => x.id === f.item.id) : favs.series.some((x) => x.id === f.item.id);
  const watch = () => {
    if (f.kind === "vod") play({ title, stream: f.item.stream, type: "vod", poster: m?.poster ?? f.item.poster, ua: f.item.ua, referer: f.item.referer, tmdb: m?.tmdbId ? { id: m.tmdbId } : undefined });
    else onDetails(f);
  };

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <HeroShell key={f.item.id}>
        <TitleBlock title={title} logo={m?.logo} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(m?.year || f.item.year) && <Chip>{(m?.year || f.item.year)!.slice(0, 4)}</Chip>}
          {m?.genres.length ? <Chip>{m.genres.slice(0, 3).map(genreName).join(", ")}</Chip> : null}
          {m?.runtime && <Chip>{m.runtime}</Chip>}
          {m?.imdbRating ? <ImdbBadge value={m.imdbRating} size="lg" /> : null}
        </div>
        {m?.plot && <p className="line-clamp-2 max-w-[640px] text-[15px] leading-relaxed text-sky-50/80">{m.plot}</p>}
        <div className="mt-5 flex gap-3">
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
        {featured.length > 1 && (
          <div className="mt-5 flex gap-2">
            {featured.map((x, k) => (
              <button key={x.item.id} onClick={() => setI(k)} aria-label={t("Destaque {0}", { 0: k + 1 })} className={cn("h-1.5 rounded-full transition-all", k === i ? "bg-storm w-8" : "w-3 bg-white/25 hover:bg-white/50")} />
            ))}
          </div>
        )}
      </HeroShell>
    </div>
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
    <section className="group/row mb-8">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="text-sky-100/70">{icon}</span>
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

function ContinueRow({ items, selKey, onSelect }: { items: HistoryEntry[]; selKey: string | null; onSelect: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <Row title={t("Continuar a ver")} icon={<History className="size-[18px]" />}>
      {items.map((h) => (
        <ContinueCard key={h.key} h={h} active={h.key === selKey} onSelect={() => onSelect(h.key)} />
      ))}
    </Row>
  );
}

function ContinueCard({ h, active, onSelect }: { h: HistoryEntry; active: boolean; onSelect: () => void }) {
  const play = useApp((s) => s.play);
  const metaOn = useApp((s) => s.settings.metadata);
  const m = useHistoryMeta(h, metaOn);
  const pct = h.position && h.duration ? Math.round((h.position / h.duration) * 100) : 0;
  const ep = h.play.type === "episode" ? h.play.subtitle?.split(" · ")[0] : undefined;
  const title = m?.title ?? cleanTitle(h.title).title;
  const year = m?.year?.slice(0, 4);
  const line = h.play.type === "episode" && h.play.subtitle ? h.play.subtitle : m?.plot;
  return (
    <button
      onClick={() => play(h.play)}
      onMouseEnter={onSelect}
      onFocus={onSelect}
      className="focusable group w-[270px] shrink-0 rounded-xl text-left"
    >
      <div className={cn("overflow-hidden rounded-xl bg-ink-800/90 ring-2 transition", active ? "ring-violet-400/80" : "ring-transparent group-hover:ring-white/20")}>
        <div className="relative">
          <Poster src={m?.backdrop ?? h.poster} name={h.title} className="aspect-video" />
          {pct > 0 && <span className="absolute top-2 right-2 rounded-md bg-violet-600 px-1.5 py-0.5 text-[11px] font-bold">{pct}%</span>}
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-2.5 pt-8 pb-2 text-[11px] font-semibold tabular-nums">
            <span>{ep ?? year}</span>
            <span className="ml-auto flex items-center gap-2 text-sky-100/85">
              {m?.imdbRating ? (
                <span className="inline-flex items-center gap-0.5">
                  <Star className="size-3 fill-current text-amber-300" /> {m.imdbRating.toFixed(1)}
                </span>
              ) : null}
              {h.duration ? fmtClock(h.duration) : ""}
            </span>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
            <div className="h-full bg-violet-400" style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        </div>
        <div className="px-3 pt-2.5 pb-3">
          <div className="truncate text-[13px] font-bold">{year && h.play.type !== "episode" ? `${title} - ${year}` : title}</div>
          <div className="mt-0.5 truncate text-[11px] text-sky-100/50">{line ?? (h.duration && h.position ? fmtLeftLabel(h.duration - h.position) : "")}</div>
        </div>
      </div>
    </button>
  );
}

const fmtClock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const fmtLeftLabel = (sec: number) => t("Falta {0}", { 0: fmtLeft(sec) });

function LiveNowRow() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const favs = useFavs();
  const history = useHistory();
  const nav = useApp((s) => s.nav);
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());
  const cats = useQuery(`live-cats:${profile.id}`, () => provider.liveCategories());
  const par = useParental("live", cats.data);
  // favourites first, then what you watched recently, then the rest of the list
  const channels = useMemo(() => {
    const byStream = new Map((all.data ?? []).map((c) => [c.stream, c]));
    const seen = new Set<string>();
    const recent: Channel[] = [];
    for (const h of [...history].sort((x, y) => y.at - x.at)) {
      if (h.play.type !== "live") continue;
      const c = byStream.get(h.play.stream);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        recent.push(c);
      }
    }
    const rest = (all.data ?? []).filter((c) => !c.isRadio);
    const seen2 = new Set<string>();
    return [...favs.live, ...recent, ...rest].filter((c) => (seen2.has(c.id) ? false : (seen2.add(c.id), true)) && !par.hidden.has(c.categoryId ?? "")).slice(0, 20);
  }, [history, all.data, favs.live, par.hidden]);
  if (!channels.length) return null;
  return (
    <Row title={t("TV em direto")} icon={<Tv className="size-[18px]" />} action={{ label: t("Guia TV"), onClick: () => nav("epg") }}>
      {channels.map((c, i) => (
        <LiveCard key={c.id} ch={c} list={channels} index={i} />
      ))}
    </Row>
  );
}

function LiveCard({ ch, list, index }: { ch: Channel; list: Channel[]; index: number }) {
  const play = useApp((s) => s.play);
  return (
    <button
      onClick={() => play({ title: ch.name, stream: ch.stream, type: "live", channels: list, index, poster: ch.logo, ua: ch.ua, referer: ch.referer })}
      title={ch.name}
      className="focusable group relative h-[110px] w-[170px] shrink-0 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-white/10 transition hover:ring-sky-300/50"
    >
      <TileLogo src={ch.logo} name={ch.name} />
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2.5 pt-4 pb-1.5 text-[11px] font-semibold text-white">{ch.name}</span>
      <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="bg-storm grid size-11 place-items-center rounded-full text-ink-950">
          <Play className="ml-0.5 size-5 fill-current" />
        </span>
      </span>
    </button>
  );
}

/** Logo centred in the tile (above the name strip); falls back to initials if the image fails. */
function TileLogo({ src, name }: { src?: string; name: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <ChannelLogo name={name} className="absolute inset-0 !rounded-none text-xl" />;
  return (
    <div className="absolute inset-x-4 top-3 bottom-9">
      <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className="size-full object-contain" draggable={false} />
    </div>
  );
}
