import { ArrowDown, ArrowUp, CalendarDays, Clapperboard, Clock3, Film, LayoutGrid, Play, Star, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, CastRow, CategoryList, Empty, ImdbBadge, Pill, Poster, Rating, ScreenHeader, SearchBox, Spinner, useIncremental } from "../components/ui";
import { tmdbEnabled } from "../lib/http";
import { cleanTitle, genreName, seasonMeta, useInView, useMeta, type Meta as MetaT } from "../lib/meta";
import { useParental } from "../lib/parental";
import { useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { SeriesItem, VodItem } from "../lib/types";
import { cn, fmtDate } from "../lib/util";
import { useApp, useFavs, useHistory, useProfile, useProvider } from "../store/app";

import { t, tn } from "../lib/i18n";
type Kind = "vod" | "series";
type Item = VodItem | SeriesItem;

const SORTS = [
  { id: "default", get label() { return t("Recentes"); } },
  { id: "az", get label() { return t("A–Z"); } },
  { id: "rating", get label() { return t("Avaliação"); } },
  { id: "year", get label() { return t("Ano"); } },
] as const;

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true, ignorePunctuation: true });
/** alphabetical on the cleaned title, so "PT | The Matrix 1080p" sorts under T, not P */
const cleaned = new Map<string, ReturnType<typeof cleanTitle>>();
const clean = (name: string) => {
  let c = cleaned.get(name);
  if (!c) cleaned.set(name, (c = cleanTitle(name)));
  return c;
};
const byTitle = (a: Item, b: Item) => collator.compare(clean(a.name).title, clean(b.name).title);
/** 4-digit year from the provider field ("2021", "2021-05-03") or the title; 0 when unknown */
const yearOf = (x: Item) => Number(/(?:19|20)d{2}/.exec(x.year ?? "")?.[0] ?? clean(x.name).year ?? 0);

export function MediaScreen({ kind }: { kind: Kind }) {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const settings = useApp((s) => s.settings);
  const favs = useFavs();
  const [cat, setCat] = useState("__all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("default");
  /** true = opposite of the sort's natural direction (A–Z natural is ascending, the rest descending) */
  const [rev, setRev] = useState(false);
  const pickSort = (id: (typeof SORTS)[number]["id"]) => {
    if (id === sort) setRev((r) => !r);
    else {
      setSort(id);
      setRev(false);
    }
  };
  const [open, setOpen] = useState<Item | null>(null);

  const cats = useQuery(`${kind}-cats:${profile.id}`, () => (kind === "vod" ? provider.vodCategories() : provider.seriesCategories()));
  const par = useParental(kind, cats.data);
  const realCat = cat.startsWith("__") ? undefined : cat;
  // Stalker & big Xtream catalogues: load per category, "all" lazily
  const items = useQuery<Item[]>(`${kind}-items:${profile.id}:${realCat ?? "all"}`, () =>
    kind === "vod" ? provider.vodItems(realCat) : provider.seriesItems(realCat),
  );

  const categories = useMemo(() => (settings.hideAdult ? (cats.data ?? []).filter((c) => !isAdult(c.name)) : (cats.data ?? [])), [cats.data, settings.hideAdult]);

  const list = useMemo(() => {
    let l: Item[] = cat === "__fav" ? (kind === "vod" ? favs.vod : favs.series) : (items.data ?? []);
    if (settings.hideAdult) {
      const adult = new Set((cats.data ?? []).filter((c) => isAdult(c.name)).map((c) => c.id));
      l = l.filter((x) => !adult.has(x.categoryId ?? ""));
    }
    if (par.hidden.size) l = l.filter((x) => !par.hidden.has(x.categoryId ?? ""));
    if (q) {
      const s = q.toLowerCase();
      l = l.filter((x) => x.name.toLowerCase().includes(s));
    }
    const d = rev ? -1 : 1;
    if (sort === "default") {
      // newest first when the provider tells us; otherwise keep its own order (Stalker already sends newest first)
      if (l.some((x) => x.added)) l = [...l].sort((x, y) => d * ((y.added ?? 0) - (x.added ?? 0)));
      else if (rev) l = [...l].reverse();
    } else if (sort === "az") {
      l = [...l].sort((x, y) => d * byTitle(x, y));
    } else if (sort === "rating") {
      // unrated titles stay last in both directions, ties alphabetical
      l = [...l].sort((x, y) => (!x.rating ? 1 : 0) - (!y.rating ? 1 : 0) || d * ((y.rating ?? 0) - (x.rating ?? 0)) || byTitle(x, y));
    } else if (sort === "year") {
      l = [...l].sort((x, y) => (!yearOf(x) ? 1 : 0) - (!yearOf(y) ? 1 : 0) || d * (yearOf(y) - yearOf(x)) || byTitle(x, y));
    }
    return l;
  }, [cat, kind, favs, items.data, q, sort, rev, settings.hideAdult, cats.data, par.hidden]);

  const { visible, onScroll } = useIncremental(list, 90);
  const loading = cat !== "__fav" && items.loading;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={kind === "vod" ? t("Filmes") : t("Séries")} icon={kind === "vod" ? <Film className="size-5" /> : <Clapperboard className="size-5" />}>
        <SearchBox value={q} onChange={setQ} placeholder={kind === "vod" ? t("Pesquisar filmes…") : t("Pesquisar séries…")} className="w-80" />
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          {SORTS.map((s) => (
            <button key={s.id} onClick={() => pickSort(s.id)} className={cn("focusable inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition", sort === s.id ? "bg-white/15 text-white" : "text-sky-100/55 hover:text-white")}>
              {s.label}
              {sort === s.id && ((s.id === "az") !== rev ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
            </button>
          ))}
        </div>
        <Pill tone="slate">{tn(list.length, "1 título", "{n} títulos")}</Pill>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <CategoryList
          parental={par}
          loading={cats.loading}
          categories={categories}
          active={cat}
          onSelect={setCat}
          extra={[
            { id: "__all", name: t("Todos"), icon: <LayoutGrid className="size-4" /> },
            { id: "__fav", name: t("Favoritos"), icon: <Star className="size-4" /> },
          ]}
        />
        <div className="min-w-0 flex-1 overflow-y-auto p-5" onScroll={onScroll}>
          {kind === "vod" && cat === "__all" && !q && <ContinueWatching />}
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {Array.from({ length: 18 }, (_, i) => (
                <div key={i} className="skeleton aspect-[2/3] rounded-xl" />
              ))}
            </div>
          ) : items.error && cat !== "__fav" ? (
            <Empty title={t("Erro ao carregar")} hint={items.error} />
          ) : !list.length ? (
            <Empty icon={kind === "vod" ? <Film className="size-6" /> : <Clapperboard className="size-6" />} title={t("Nada por aqui")} hint={cat === "__fav" ? t("Adiciona títulos aos favoritos para os veres aqui.") : t("Tenta outra categoria ou pesquisa.")} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {visible.map((it) => (
                <PosterCard key={it.id} item={it} kind={kind} onClick={() => setOpen(it)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {open && (kind === "vod" ? <VodDetail item={open as VodItem} onClose={() => setOpen(null)} /> : <SeriesDetail item={open as SeriesItem} onClose={() => setOpen(null)} />)}
    </div>
  );
}

/** Prefer the database poster when the match is confident; keep the other as fallback. */
export function posterPair(meta: MetaT | null | undefined, own?: string) {
  if (meta?.confident && meta.poster) return { src: meta.poster, fallback: own };
  return { src: own, fallback: meta?.poster };
}

export function PosterCard({ item, kind, onClick }: { item: Item; kind: Kind; onClick: () => void }) {
  const { ref, seen } = useInView<HTMLButtonElement>();
  const meta = useMeta(kind === "vod" ? "movie" : "series", item.name, item.year, seen);
  const p = posterPair(meta, item.poster);
  const title = meta?.confident ? meta.title : cleanTitle(item.name).title;
  const year = item.year || meta?.year;
  return (
    <button ref={ref} onClick={onClick} title={item.name} className="focusable group relative block w-full rounded-xl text-left transition duration-200 hover:-translate-y-1 focus-visible:-translate-y-1">
      <Poster src={p.src} fallback={p.fallback} name={title} className="aspect-[2/3] rounded-xl shadow-lg shadow-black/40 ring-1 ring-white/10 transition group-hover:ring-2 group-hover:ring-sky-300/70" />
      <div className="absolute top-2 left-2">{meta?.imdbRating ? <ImdbBadge value={meta.imdbRating} /> : <Rating value={item.rating} />}</div>
      <div className="mt-2 truncate text-[13px] font-semibold">{title}</div>
      <div className="flex items-center gap-1.5 truncate text-[11px] text-sky-100/45">
        {year && <span>{year.slice(0, 4)}</span>}
        {year && meta?.genres?.[0] && <span className="size-0.5 rounded-full bg-sky-100/40" />}
        {meta?.genres?.[0] && <span className="truncate">{genreName(meta.genres[0])}</span>}
        {!year && !meta?.genres?.[0] && " "}
      </div>
    </button>
  );
}

function ContinueWatching() {
  const history = useHistory().filter((h) => h.play.type === "vod" && h.position && h.duration && h.position / h.duration < 0.95);
  const play = useApp((s) => s.play);
  if (!history.length) return null;
  return (
    <div className="mb-7">
      <div className="mb-3 text-sm font-bold tracking-wide text-sky-100/70">{t("Continuar a ver")}</div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {history.slice(0, 12).map((h) => (
          <button key={h.key} onClick={() => play(h.play)} className="focusable group w-64 shrink-0 rounded-xl text-left">
            <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
              <Poster src={h.poster} name={h.title} className="aspect-video" />
              <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                <Play className="size-10 fill-white" />
              </div>
              <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                <div className="h-full bg-sky-400" style={{ width: `${(h.position! / h.duration!) * 100}%` }} />
              </div>
            </div>
            <div className="mt-1.5 truncate text-sm font-semibold">{h.title}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Modal({ children, onClose, backdrop }: { children: React.ReactNode; onClose: () => void; backdrop?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.key === "Backspace" && (e.target as HTMLElement).tagName !== "INPUT")) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const playing = useApp((s) => !!s.playing);
  return (
    <div data-focus-scope={playing ? undefined : ""} className="fixed inset-0 z-30 flex items-center justify-center bg-ink-950/70 p-8 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-ink-900 shadow-2xl shadow-black/60 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
        {backdrop && <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover opacity-25" onError={(e) => (e.currentTarget.style.display = "none")} />}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/90 to-ink-900/40" />
        <button onClick={onClose} className="focusable absolute top-4 right-4 z-10 grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/20">
          <X className="size-5" />
        </button>
        <div className="relative min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- shared detail header ---------------- */

function DetailHero({
  kind,
  item,
  meta,
  ownPlot,
  ownGenre,
  ownCast,
  ownDirector,
  duration,
  releaseDate,
  loading,
  extraPills,
  actions,
  compact,
}: {
  kind: "movie" | "series";
  item: Item;
  meta: MetaT | null | undefined;
  ownPlot?: string;
  ownGenre?: string;
  ownCast?: string;
  ownDirector?: string;
  duration?: string;
  releaseDate?: string;
  loading?: boolean;
  extraPills?: React.ReactNode;
  actions: React.ReactNode;
  compact?: boolean;
}) {
  const hasTmdb = tmdbEnabled();
  const p = posterPair(meta, item.poster);
  const clean = cleanTitle(item.name);
  const title = meta?.confident ? meta.title : clean.title;
  // TMDB gives Portuguese synopses; without it the provider's text is usually PT, Cinemeta's is EN
  const plot = (hasTmdb ? meta?.plot : undefined) || ownPlot || meta?.plot;
  const genres = (meta?.genres?.length ? meta.genres : ownGenre ? ownGenre.split(/\s*[,/]\s*/).filter(Boolean) : []).map(genreName);
  const director = meta?.director?.length ? meta.director.join(", ") : ownDirector;
  const cast = meta?.cast?.length
    ? meta.cast
    : (ownCast ?? "")
        .split(/\s*,\s*/)
        .filter(Boolean)
        .slice(0, 12)
        .map((name) => ({ name }));
  const year = (releaseDate || item.year || meta?.year || "").slice(0, 4);
  const runtime = duration || meta?.runtime;
  const metaLoading = meta === undefined && useApp.getState().settings.metadata;

  return (
    <div className={cn("flex gap-8 p-8", compact && "pb-4")}>
      <div className="w-56 shrink-0">
        <Poster src={p.src} fallback={p.fallback} name={title} className="aspect-[2/3] w-full rounded-2xl shadow-2xl shadow-black/60 ring-1 ring-white/10" />
      </div>
      <div className="min-w-0 flex-1 pr-10">
        {meta?.logo && meta.confident ? (
          <img src={meta.logo} alt={title} className="mb-1 max-h-20 max-w-[70%] object-contain object-left drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <h2 className="text-3xl font-extrabold tracking-tight text-shadow">{title}</h2>
        )}
        {meta?.logo && meta.confident && <h2 className="sr-only">{title}</h2>}
        {title !== item.name && <div className="mt-1 truncate text-xs text-sky-100/35">{item.name}</div>}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {meta?.imdbRating ? <ImdbBadge value={meta.imdbRating} size="lg" /> : item.rating ? <Rating value={item.rating} /> : null}
          {meta?.tmdbRating && !meta.imdbRating ? <Pill tone="green">{t("TMDB")} {meta.tmdbRating.toFixed(1)}</Pill> : null}
          {year && <MetaLine icon={<CalendarDays className="size-4" />}>{year}</MetaLine>}
          {runtime && <MetaLine icon={<Clock3 className="size-4" />}>{runtime}</MetaLine>}
          {extraPills}
        </div>

        {genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {genres.slice(0, 5).map((g) => (
              <Pill key={g}>{g}</Pill>
            ))}
          </div>
        )}

        {loading || (metaLoading && !ownPlot) ? (
          <div className="mt-5 max-w-2xl space-y-2">
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <div className="skeleton h-4 w-2/3 rounded" />
          </div>
        ) : (
          <p className={cn("mt-5 max-w-2xl text-[15px] leading-relaxed text-sky-50/80", compact && "line-clamp-4")}>{plot || t("Sem sinopse disponível.")}</p>
        )}

        {director && (
          <div className="mt-4 text-sm">
            <span className="text-sky-100/50">{kind === "movie" ? t("Realização") : t("Criação")}: </span>
            <span className="font-semibold">{director}</span>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">{actions}</div>

        {cast.length > 0 && (
          <div className="mt-7">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-widest text-sky-100/50 uppercase">
              <Users className="size-3.5" /> {t("Elenco")}
            </div>
            <CastRow cast={cast} />
          </div>
        )}
        {meta === null && useApp.getState().settings.metadata && (
          <div className="mt-4 text-[11px] text-sky-100/35">{t("Não encontrei este título na base de dados de filmes e séries.")}</div>
        )}
      </div>
    </div>
  );
}

function MetaLine({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-sky-100/70">
      {icon}
      {children}
    </span>
  );
}

/* ---------------- movie ---------------- */

export function VodDetail({ item, onClose }: { item: VodItem; onClose: () => void }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const fav = useFavs().vod.some((v) => v.id === item.id);
  const info = useQuery(`vodinfo:${item.id}:${item.stream}`, () => provider.vodInfo(item));
  const meta = useMeta("movie", item.name, item.year);
  const d = info.data;
  const resume = useHistory().find((h) => h.key === `vod:${item.stream}`);
  const pct = resume?.position && resume.duration ? resume.position / resume.duration : 0;

  return (
    <Modal onClose={onClose} backdrop={meta?.backdrop || d?.backdrop}>
      <DetailHero
        kind="movie"
        item={item}
        meta={meta}
        ownPlot={d?.plot}
        ownGenre={d?.genre}
        ownCast={d?.cast}
        ownDirector={d?.director}
        duration={d?.duration}
        releaseDate={d?.releaseDate}
        loading={info.loading}
        actions={
          <>
            <Button autoFocus onClick={() => play({ title: meta?.confident ? meta.title : cleanTitle(item.name).title, stream: item.stream, type: "vod", poster: posterPair(meta, item.poster).src, ua: item.ua, referer: item.referer })}>
              <Play className="size-4 fill-white" /> {resume?.position ? t("Continuar") : t("Ver agora")}
            </Button>
            <Button variant="ghost" onClick={() => toggleFav("vod", item)}>
              <Star className={cn("size-4", fav && "fill-amber-300 text-amber-300")} /> {fav ? t("Nos favoritos") : t("Favorito")}
            </Button>
            {pct > 0 && pct < 0.95 && (
              <div className="flex items-center gap-2 text-xs text-sky-100/55">
                <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-sky-400" style={{ width: `${pct * 100}%` }} />
                </div>
                {Math.round(pct * 100)}{t("% visto")}
              </div>
            )}
          </>
        }
      />
    </Modal>
  );
}

/* ---------------- series ---------------- */

const GENERIC_EP = /^(epis[oó]dio|[eé]pisode|folge|episode|ep\.?)\s*\d+$|S\d{1,2}\s*E\d{1,3}/i;

export function SeriesDetail({ item, onClose }: { item: SeriesItem; onClose: () => void }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const hasTmdb = tmdbEnabled();
  const fav = useFavs().series.some((v) => v.id === item.id);
  const info = useQuery(`seriesinfo:${item.id}`, () => provider.seriesInfo(item));
  const meta = useMeta("series", item.name, item.year);
  const [season, setSeason] = useState<number | null>(null);
  const seasons = info.data?.seasons ?? [];
  const cur = seasons.find((s) => s.num === season) ?? seasons[0];
  const tmdbSeason = useQuery(hasTmdb && meta?.tmdbId && cur ? `tmdb-season:${meta.tmdbId}:${cur.num}` : null, () => seasonMeta(meta!.tmdbId!, cur!.num));
  const showTitle = meta?.confident ? meta.title : cleanTitle(item.name).title;

  const episodes = useMemo(
    () =>
      (cur?.episodes ?? []).map((e) => {
        const key = `${e.season}:${e.num}`;
        const em = { ...meta?.episodes?.[key], ...tmdbSeason.data?.[key] };
        const generic = !e.title || GENERIC_EP.test(e.title) || e.title.toLowerCase().includes(item.name.toLowerCase());
        return {
          ...e,
          title: (generic && em.title) || e.title || t("Episódio {0}", { 0: e.num }),
          plot: (hasTmdb ? em.plot : undefined) || e.plot || em.plot,
          image: e.image && e.image !== item.poster ? e.image : em.thumb || e.image,
          aired: em.aired,
        };
      }),
    [cur, meta, tmdbSeason.data, item.name, item.poster, hasTmdb],
  );

  const playEp = (e: (typeof episodes)[number]) =>
    play({ title: showTitle, subtitle: `T${e.season} · E${e.num} — ${e.title}`, stream: e.stream, type: "episode", poster: e.image || posterPair(meta, item.poster).src, ua: e.ua, referer: e.referer });

  return (
    <Modal onClose={onClose} backdrop={meta?.backdrop || info.data?.backdrop}>
      <DetailHero
        kind="series"
        item={item}
        meta={meta}
        ownPlot={info.data?.plot || item.plot}
        ownGenre={info.data?.genre}
        ownCast={info.data?.cast}
        compact
        extraPills={seasons.length > 0 && <Pill tone="slate">{tn(seasons.length, "1 temporada", "{n} temporadas")}</Pill>}
        actions={
          <>
            {episodes[0] && (
              <Button autoFocus onClick={() => playEp(episodes[0])}>
                <Play className="size-4 fill-white" /> {t("Ver T{s}E{e}", { s: cur!.num, e: episodes[0].num })}
              </Button>
            )}
            <Button variant="ghost" onClick={() => toggleFav("series", item)}>
              <Star className={cn("size-4", fav && "fill-amber-300 text-amber-300")} /> {fav ? t("Nos favoritos") : t("Favorito")}
            </Button>
          </>
        }
      />

      {info.loading ? (
        <Spinner label={t("A carregar episódios…")} />
      ) : info.error ? (
        <Empty title={t("Erro ao carregar episódios")} hint={info.error} />
      ) : (
        <div className="px-8 pb-8">
          <div className="mb-4 flex gap-2 overflow-x-auto border-b border-white/10 pb-3">
            {seasons.map((s) => (
              <button
                key={s.num}
                onClick={() => setSeason(s.num)}
                className={cn("focusable shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition", cur?.num === s.num ? "bg-gradient-to-r from-sky-500 to-blue-600" : "bg-white/5 text-sky-100/70 hover:bg-white/10")}
              >
                {s.name}
                <span className="ml-1.5 text-[11px] font-semibold opacity-60">{s.episodes.length}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {episodes.map((e) => (
              <button key={e.id} onClick={() => playEp(e)} className="focusable group flex gap-3 rounded-xl bg-white/[0.04] p-2 text-left transition hover:bg-white/[0.09]">
                <div className="relative w-44 shrink-0 overflow-hidden rounded-lg">
                  <Poster src={e.image} name={`${showTitle} ${e.num}`} className="aspect-video" />
                  <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Play className="size-7 fill-white" />
                  </div>
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-black tabular-nums backdrop-blur">E{String(e.num).padStart(2, "0")}</span>
                </div>
                <div className="min-w-0 py-1">
                  <div className="truncate text-sm font-semibold">{e.title}</div>
                  <div className="mt-0.5 flex gap-2 text-[11px] text-sky-100/40">
                    {e.duration && <span>{e.duration}</span>}
                    {e.aired && <span>{fmtDate(Date.parse(e.aired))}</span>}
                  </div>
                  {e.plot && <div className="mt-1 line-clamp-2 text-xs text-sky-100/55">{e.plot}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
