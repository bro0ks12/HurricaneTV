import { CalendarDays, Clapperboard, Clock3, Film, LayoutGrid, Play, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, CategoryList, Empty, Pill, Poster, Rating, ScreenHeader, SearchBox, Spinner, useIncremental } from "../components/ui";
import { useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { SeriesItem, VodItem } from "../lib/types";
import { cn } from "../lib/util";
import { useApp, useFavs, useHistory, useProfile, useProvider } from "../store/app";

type Kind = "vod" | "series";
type Item = VodItem | SeriesItem;

const SORTS = [
  { id: "default", label: "Recentes" },
  { id: "az", label: "A–Z" },
  { id: "rating", label: "Avaliação" },
  { id: "year", label: "Ano" },
] as const;

export function MediaScreen({ kind }: { kind: Kind }) {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const settings = useApp((s) => s.settings);
  const favs = useFavs();
  const [cat, setCat] = useState("__all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("default");
  const [open, setOpen] = useState<Item | null>(null);

  const cats = useQuery(`${kind}-cats:${profile.id}`, () => (kind === "vod" ? provider.vodCategories() : provider.seriesCategories()));
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
    if (q) {
      const s = q.toLowerCase();
      l = l.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "rating") l = [...l].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === "year") l = [...l].sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0));
    return l;
  }, [cat, kind, favs, items.data, q, sort, settings.hideAdult, cats.data]);

  const { visible, onScroll } = useIncremental(list, 90);
  const loading = cat !== "__fav" && items.loading;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={kind === "vod" ? "Filmes" : "Séries"} icon={kind === "vod" ? <Film className="size-5" /> : <Clapperboard className="size-5" />}>
        <SearchBox value={q} onChange={setQ} placeholder={kind === "vod" ? "Pesquisar filmes…" : "Pesquisar séries…"} className="w-80" />
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          {SORTS.map((s) => (
            <button key={s.id} onClick={() => setSort(s.id)} className={cn("focusable rounded-lg px-3 py-1.5 text-xs font-bold transition", sort === s.id ? "bg-white/15 text-white" : "text-sky-100/55 hover:text-white")}>
              {s.label}
            </button>
          ))}
        </div>
        <Pill tone="slate">{list.length} títulos</Pill>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <CategoryList
          loading={cats.loading}
          categories={categories}
          active={cat}
          onSelect={setCat}
          extra={[
            { id: "__all", name: "Todos", icon: <LayoutGrid className="size-4" /> },
            { id: "__fav", name: "Favoritos", icon: <Star className="size-4" /> },
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
            <Empty title="Erro ao carregar" hint={items.error} />
          ) : !list.length ? (
            <Empty icon={kind === "vod" ? <Film className="size-6" /> : <Clapperboard className="size-6" />} title="Nada por aqui" hint={cat === "__fav" ? "Adiciona títulos aos favoritos para os veres aqui." : "Tenta outra categoria ou pesquisa."} />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {visible.map((it) => (
                <PosterCard key={it.id} item={it} onClick={() => setOpen(it)} />
              ))}
            </div>
          )}
        </div>
      </div>
      {open && (kind === "vod" ? <VodDetail item={open as VodItem} onClose={() => setOpen(null)} /> : <SeriesDetail item={open as SeriesItem} onClose={() => setOpen(null)} />)}
    </div>
  );
}

function PosterCard({ item, onClick }: { item: Item; onClick: () => void }) {
  return (
    <button onClick={onClick} className="focusable group relative block rounded-xl text-left transition duration-200 hover:-translate-y-1 focus-visible:-translate-y-1">
      <Poster src={item.poster} name={item.name} className="aspect-[2/3] rounded-xl shadow-lg shadow-black/40 ring-1 ring-white/10 transition group-hover:ring-2 group-hover:ring-sky-300/70" />
      <div className="absolute top-2 left-2">
        <Rating value={item.rating} />
      </div>
      <div className="mt-2 truncate text-[13px] font-semibold">{item.name}</div>
      <div className="text-[11px] text-sky-100/45">{item.year ?? " "}</div>
    </button>
  );
}

function ContinueWatching() {
  const history = useHistory().filter((h) => h.play.type === "vod" && h.position && h.duration && h.position / h.duration < 0.95);
  const play = useApp((s) => s.play);
  if (!history.length) return null;
  return (
    <div className="mb-7">
      <div className="mb-3 text-sm font-bold tracking-wide text-sky-100/70">Continuar a ver</div>
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

function Meta({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-sky-100/70">
      {icon}
      {children}
    </span>
  );
}

function VodDetail({ item, onClose }: { item: VodItem; onClose: () => void }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const fav = useFavs().vod.some((v) => v.id === item.id);
  const info = useQuery(`vodinfo:${item.id}:${item.stream}`, () => provider.vodInfo(item));
  const d = info.data;
  const resume = useHistory().find((h) => h.key === `vod:${item.stream}`);

  return (
    <Modal onClose={onClose} backdrop={d?.backdrop}>
      <div className="flex gap-8 p-8">
        <Poster src={item.poster} name={item.name} className="aspect-[2/3] w-60 shrink-0 rounded-2xl shadow-2xl ring-1 ring-white/10" />
        <div className="min-w-0 flex-1 pr-10">
          <h2 className="text-3xl font-extrabold tracking-tight">{item.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {item.rating ? <Rating value={item.rating} /> : null}
            {(item.year || d?.releaseDate) && <Meta icon={<CalendarDays className="size-4" />}>{d?.releaseDate || item.year}</Meta>}
            {d?.duration && <Meta icon={<Clock3 className="size-4" />}>{d.duration}</Meta>}
            {d?.genre && <Pill>{d.genre}</Pill>}
          </div>
          {info.loading ? (
            <div className="mt-6 space-y-2">
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-5/6 rounded" />
              <div className="skeleton h-4 w-2/3 rounded" />
            </div>
          ) : (
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-sky-50/80">{d?.plot || "Sem sinopse disponível."}</p>
          )}
          {d?.director && (
            <div className="mt-4 text-sm">
              <span className="text-sky-100/50">Realização: </span>
              {d.director}
            </div>
          )}
          {d?.cast && (
            <div className="mt-1 line-clamp-2 text-sm">
              <span className="text-sky-100/50">Elenco: </span>
              {d.cast}
            </div>
          )}
          <div className="mt-7 flex gap-3">
            <Button autoFocus onClick={() => play({ title: item.name, stream: item.stream, type: "vod", poster: item.poster })}>
              <Play className="size-4 fill-white" /> {resume?.position ? "Continuar" : "Ver agora"}
            </Button>
            <Button variant="ghost" onClick={() => toggleFav("vod", item)}>
              <Star className={cn("size-4", fav && "fill-amber-300 text-amber-300")} /> {fav ? "Nos favoritos" : "Favorito"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SeriesDetail({ item, onClose }: { item: SeriesItem; onClose: () => void }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const fav = useFavs().series.some((v) => v.id === item.id);
  const info = useQuery(`seriesinfo:${item.id}`, () => provider.seriesInfo(item));
  const [season, setSeason] = useState<number | null>(null);
  const seasons = info.data?.seasons ?? [];
  const cur = seasons.find((s) => s.num === season) ?? seasons[0];

  return (
    <Modal onClose={onClose} backdrop={info.data?.backdrop}>
      <div className="flex gap-8 p-8 pb-4">
        <Poster src={item.poster} name={item.name} className="aspect-[2/3] w-44 shrink-0 rounded-2xl shadow-2xl ring-1 ring-white/10" />
        <div className="min-w-0 flex-1 pr-10">
          <h2 className="text-3xl font-extrabold tracking-tight">{item.name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {item.rating ? <Rating value={item.rating} /> : null}
            {item.year && <Meta icon={<CalendarDays className="size-4" />}>{item.year}</Meta>}
            {info.data?.genre && <Pill>{info.data.genre}</Pill>}
            {seasons.length > 0 && <Pill tone="slate">{seasons.length} temporada{seasons.length > 1 ? "s" : ""}</Pill>}
          </div>
          <p className="mt-4 line-clamp-3 max-w-2xl text-[15px] leading-relaxed text-sky-50/80">{info.data?.plot || item.plot || "Sem sinopse disponível."}</p>
          <div className="mt-5 flex gap-3">
            {cur?.episodes[0] && (
              <Button autoFocus onClick={() => play({ title: item.name, subtitle: `T${cur.num} · E${cur.episodes[0].num} — ${cur.episodes[0].title}`, stream: cur.episodes[0].stream, type: "episode", poster: item.poster })}>
                <Play className="size-4 fill-white" /> Ver T{cur.num}E{cur.episodes[0].num}
              </Button>
            )}
            <Button variant="ghost" onClick={() => toggleFav("series", item)}>
              <Star className={cn("size-4", fav && "fill-amber-300 text-amber-300")} /> {fav ? "Nos favoritos" : "Favorito"}
            </Button>
          </div>
        </div>
      </div>

      {info.loading ? (
        <Spinner label="A carregar episódios…" />
      ) : info.error ? (
        <Empty title="Erro ao carregar episódios" hint={info.error} />
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
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {cur?.episodes.map((e) => (
              <button
                key={e.id}
                onClick={() => play({ title: item.name, subtitle: `T${e.season} · E${e.num} — ${e.title}`, stream: e.stream, type: "episode", poster: e.image || item.poster })}
                className="focusable group flex gap-3 rounded-xl bg-white/[0.04] p-2 text-left transition hover:bg-white/[0.09]"
              >
                <div className="relative w-40 shrink-0 overflow-hidden rounded-lg">
                  <Poster src={e.image} name={`${item.name} ${e.num}`} className="aspect-video" />
                  <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Play className="size-7 fill-white" />
                  </div>
                </div>
                <div className="min-w-0 py-1">
                  <div className="text-xs font-bold text-sky-300">Episódio {e.num}</div>
                  <div className="truncate text-sm font-semibold">{e.title}</div>
                  {e.plot && <div className="mt-1 line-clamp-2 text-xs text-sky-100/55">{e.plot}</div>}
                  {e.duration && <div className="mt-1 text-[11px] text-sky-100/40">{e.duration}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
