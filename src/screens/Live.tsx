import { Expand, History, LayoutList, Radio, Star, Tv } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CategoryList, ChannelLogo, Empty, Pill, ProgressBar, ScreenHeader, SearchBox, Spinner, useIncremental } from "../components/ui";
import { VideoSurface } from "../components/VideoSurface";
import { useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { Channel } from "../lib/types";
import { cn, fmtTime, progress } from "../lib/util";
import { STALKER_UA } from "../providers/stalker";
import { useApp, useFavs, useProfile, useProvider } from "../store/app";

export function Live({ radio = false }: { radio?: boolean }) {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const settings = useApp((s) => s.settings);
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const favs = useFavs();
  const [cat, setCat] = useState<string>(radio ? "__all" : "__all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Channel | null>(null);

  const cats = useQuery(`live-cats:${profile.id}`, () => provider.liveCategories());
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());

  const categories = useMemo(() => {
    let c = cats.data ?? [];
    if (settings.hideAdult) c = c.filter((x) => !isAdult(x.name));
    if (radio && all.data) {
      const withRadio = new Set(all.data.filter((x) => x.isRadio).map((x) => x.categoryId));
      c = c.filter((x) => withRadio.has(x.id));
    }
    return c;
  }, [cats.data, settings.hideAdult, radio, all.data]);

  const channels = useMemo(() => {
    let list: Channel[] = cat === "__fav" ? favs.live : (all.data ?? []);
    if (radio) list = list.filter((c) => c.isRadio);
    if (cat !== "__all" && cat !== "__fav") list = list.filter((c) => c.categoryId === cat);
    if (settings.hideAdult && cat === "__all") {
      const adult = new Set((cats.data ?? []).filter((x) => isAdult(x.name)).map((x) => x.id));
      list = list.filter((c) => !adult.has(c.categoryId ?? ""));
    }
    if (q) {
      const s = q.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(s) || String(c.num) === s);
    }
    return list;
  }, [cat, all.data, favs.live, q, radio, settings.hideAdult, cats.data]);

  const { visible, onScroll } = useIncremental(channels, 150);

  const open = (ch: Channel) => {
    const index = channels.findIndex((c) => c.id === ch.id);
    play({ title: ch.name, stream: ch.stream, type: "live", channels, index, poster: ch.logo });
  };

  const counts: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of all.data ?? []) if (!radio || c.isRadio) m[c.categoryId ?? ""] = (m[c.categoryId ?? ""] ?? 0) + 1;
    return m;
  }, [all.data, radio]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={radio ? "Rádio" : "TV em Direto"} icon={radio ? <Radio className="size-5" /> : <Tv className="size-5" />}>
        <SearchBox value={q} onChange={setQ} placeholder="Pesquisar canal ou número…" className="w-80" />
        <Pill tone="slate">{channels.length} canais</Pill>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <CategoryList
          loading={cats.loading}
          categories={categories.map((c) => ({ ...c, count: counts[c.id] }))}
          active={cat}
          onSelect={setCat}
          extra={[
            { id: "__all", name: "Todos os canais", icon: <LayoutList className="size-4" /> },
            { id: "__fav", name: "Favoritos", icon: <Star className="size-4" /> },
          ]}
        />

        <div className="flex min-w-0 flex-1 flex-col border-r border-white/10 bg-ink-950/20">
          {all.loading ? (
            <Spinner label="A carregar canais…" />
          ) : all.error ? (
            <Empty title="Não foi possível carregar os canais" hint={all.error} />
          ) : !channels.length ? (
            <Empty icon={<Tv className="size-6" />} title="Sem canais" hint={cat === "__fav" ? "Marca canais com a estrela para os veres aqui." : "Esta categoria está vazia."} />
          ) : (
            <div className="flex-1 overflow-y-auto p-2" onScroll={onScroll}>
              {visible.map((ch) => (
                <ChannelRow
                  key={ch.id}
                  ch={ch}
                  active={sel?.id === ch.id}
                  fav={favs.live.some((f) => f.id === ch.id)}
                  onSelect={() => (sel?.id === ch.id ? open(ch) : setSel(ch))}
                  onOpen={() => open(ch)}
                  onFav={() => toggleFav("live", ch)}
                />
              ))}
            </div>
          )}
        </div>

        <Preview channel={sel} onOpen={() => sel && open(sel)} autoplay={settings.autoplayPreview} ua={profile.kind === "stalker" ? STALKER_UA : undefined} />
      </div>
    </div>
  );
}

function ChannelRow({ ch, active, fav, onSelect, onOpen, onFav }: { ch: Channel; active: boolean; fav: boolean; onSelect: () => void; onOpen: () => void; onFav: () => void }) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl pr-2 transition",
        active ? "bg-gradient-to-r from-sky-500/30 to-blue-600/10 ring-1 ring-sky-400/50" : "hover:bg-white/[0.06]",
      )}
    >
      <button onClick={onSelect} onDoubleClick={onOpen} className="focusable flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left">
        <span className="w-10 text-right text-sm font-bold text-sky-100/40 tabular-nums">{ch.num ?? ""}</span>
        <ChannelLogo src={ch.logo} name={ch.name} className="size-11" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{ch.name}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-sky-100/45">
            {ch.catchup && (
              <span className="inline-flex items-center gap-1 text-emerald-300/80">
                <History className="size-3" /> Catch-up
              </span>
            )}
          </span>
        </span>
      </button>
      <button onClick={onFav} className={cn("focusable grid size-8 place-items-center rounded-lg transition hover:bg-white/10", fav ? "text-amber-300" : "text-white/25 opacity-0 group-hover:opacity-100")}>
        <Star className={cn("size-4", fav && "fill-amber-300")} />
      </button>
    </div>
  );
}

function Preview({ channel, onOpen, autoplay, ua }: { channel: Channel | null; onOpen: () => void; autoplay: boolean; ua?: string }) {
  const provider = useProvider()!;
  const h24 = useApp((s) => s.settings.timeFormat24);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<string>("loading");
  const epg = useQuery(channel ? `epg:${channel.id}` : null, () => provider.epg(channel!, 8));

  useEffect(() => {
    setUrl(null);
    if (!channel || !autoplay) return;
    let alive = true;
    const t = setTimeout(() => {
      provider
        .resolve(channel.stream, "live")
        .then((u) => alive && setUrl(u))
        .catch(() => alive && setState("error"));
    }, 350); // debounce while scrolling with arrows
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [channel, autoplay, provider]);

  if (!channel)
    return (
      <div className="hidden w-[38%] max-w-[620px] shrink-0 xl:block">
        <Empty icon={<Tv className="size-6" />} title="Escolhe um canal" hint="Seleciona um canal para pré-visualizar. Clica de novo (ou Enter) para ver em ecrã inteiro." />
      </div>
    );

  const now = Date.now();
  return (
    <div className="flex w-[38%] max-w-[620px] shrink-0 flex-col bg-ink-950/30">
      <button onClick={onOpen} className="focusable group relative aspect-video w-full overflow-hidden bg-black">
        {url ? (
          <VideoSurface url={url} live muted={false} ua={ua} onStatus={(s) => setState(s.state)} />
        ) : (
          <div className="grid size-full place-items-center">
            <ChannelLogo src={channel.logo} name={channel.name} className="size-24 text-2xl" />
          </div>
        )}
        {url && state === "loading" && <div className="absolute inset-0 grid place-items-center bg-black/30"><Spinner /></div>}
        {state === "error" && <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-rose-200">Stream indisponível</div>}
        <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-bold opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Expand className="size-3.5" /> Ecrã inteiro
        </span>
      </button>
      <div className="flex items-center gap-3 border-b border-white/10 p-4">
        <ChannelLogo src={channel.logo} name={channel.name} className="size-12" />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{channel.name}</div>
          <div className="text-xs text-sky-100/50">{channel.num ? `Canal ${channel.num}` : "Canal"}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 px-1 text-[11px] font-bold tracking-widest text-sky-100/50 uppercase">Programação</div>
        {epg.loading && Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton mb-2 h-14 rounded-xl" />)}
        {!epg.loading && !epg.data?.length && <div className="px-1 py-6 text-center text-sm text-sky-100/40">Sem informação de EPG.</div>}
        {epg.data?.map((p, i) => {
          const live = p.start <= now && p.end > now;
          return (
            <div key={i} className={cn("mb-1.5 rounded-xl p-3", live ? "bg-sky-400/10 ring-1 ring-sky-400/30" : "bg-white/[0.03]")}>
              <div className="flex items-center gap-2 text-xs text-sky-100/60 tabular-nums">
                {fmtTime(p.start, h24)} – {fmtTime(p.end, h24)}
                {live && <span className="rounded bg-rose-600 px-1.5 text-[10px] font-black tracking-wider text-white">AGORA</span>}
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold">{p.title}</div>
              {live && <ProgressBar value={progress(p)} className="mt-2" />}
              {live && p.description && <div className="mt-2 line-clamp-3 text-xs text-sky-100/55">{p.description}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
