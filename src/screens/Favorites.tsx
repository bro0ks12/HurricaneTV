import { Clapperboard, Film, History, Play, Star, Trash2, Tv } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ChannelLogo, Empty, Poster, ScreenHeader } from "../components/ui";
import { cn, fmtDate } from "../lib/util";
import { useApp, useFavs, useHistory } from "../store/app";

type Tab = "live" | "vod" | "series" | "recent";

export function Favorites() {
  const favs = useFavs();
  const history = useHistory();
  const play = useApp((s) => s.play);
  const toggleFav = useApp((s) => s.toggleFav);
  const go = useApp((s) => s.go);
  const [tab, setTab] = useState<Tab>("live");

  const tabs: { id: Tab; label: string; icon: ReactNode; count: number }[] = [
    { id: "live", label: "Canais", icon: <Tv className="size-4" />, count: favs.live.length },
    { id: "vod", label: "Filmes", icon: <Film className="size-4" />, count: favs.vod.length },
    { id: "series", label: "Séries", icon: <Clapperboard className="size-4" />, count: favs.series.length },
    { id: "recent", label: "Vistos recentemente", icon: <History className="size-4" />, count: history.length },
  ];

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Favoritos" icon={<Star className="size-5" />}>
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn("focusable flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition", tab === t.id ? "bg-white/15 text-white" : "text-sky-100/55 hover:text-white")}>
              {t.icon}
              {t.label}
              <span className="rounded-md bg-white/10 px-1.5 text-[10px] tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === "live" &&
          (favs.live.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {favs.live.map((ch, i) => (
                <div key={ch.id} className="group glass flex items-center gap-3 rounded-2xl p-3">
                  <button onClick={() => play({ title: ch.name, stream: ch.stream, type: "live", channels: favs.live, index: i, poster: ch.logo })} className="focusable flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left">
                    <ChannelLogo src={ch.logo} name={ch.name} className="size-12" />
                    <span className="truncate font-semibold">{ch.name}</span>
                  </button>
                  <button onClick={() => toggleFav("live", ch)} className="focusable grid size-8 place-items-center rounded-lg text-white/30 hover:bg-rose-500/15 hover:text-rose-300">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<Star className="size-6" />} title="Sem canais favoritos" hint="Usa a estrela na lista de canais ou no leitor." action={<button className="focusable text-sm font-semibold text-sky-300" onClick={() => go("live")}>Ir para TV em Direto →</button>} />
          ))}

        {(tab === "vod" || tab === "series") &&
          ((tab === "vod" ? favs.vod : favs.series).length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
              {(tab === "vod" ? favs.vod : favs.series).map((it) => (
                <div key={it.id} className="group relative">
                  <button
                    onClick={() => (tab === "vod" ? play({ title: it.name, stream: (it as { stream: string }).stream, type: "vod", poster: it.poster }) : go("series"))}
                    className="focusable block w-full rounded-xl text-left"
                  >
                    <Poster src={it.poster} name={it.name} className="aspect-[2/3] rounded-xl ring-1 ring-white/10" />
                    <div className="mt-2 truncate text-[13px] font-semibold">{it.name}</div>
                  </button>
                  <button onClick={() => toggleFav(tab, it)} className="absolute top-2 right-2 grid size-8 place-items-center rounded-lg bg-black/60 text-white/70 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-rose-300">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<Star className="size-6" />} title="Ainda sem favoritos" hint="Abre um título e carrega em «Favorito»." />
          ))}

        {tab === "recent" &&
          (history.length ? (
            <div className="space-y-2">
              {history.map((h) => (
                <button key={h.key} onClick={() => play(h.play)} className="focusable glass group flex w-full items-center gap-4 rounded-2xl p-3 text-left hover:bg-white/10">
                  <Poster src={h.poster} name={h.title} className="aspect-video w-32 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{h.title}</div>
                    {h.play.subtitle && <div className="truncate text-sm text-sky-100/60">{h.play.subtitle}</div>}
                    <div className="mt-1 text-xs text-sky-100/40">{fmtDate(h.at)}</div>
                    {h.position && h.duration ? (
                      <div className="mt-2 h-1 w-60 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full bg-sky-400" style={{ width: `${(h.position / h.duration) * 100}%` }} />
                      </div>
                    ) : null}
                  </div>
                  <Play className="mr-2 size-6 fill-white opacity-0 transition group-hover:opacity-100" />
                </button>
              ))}
            </div>
          ) : (
            <Empty icon={<History className="size-6" />} title="Sem histórico" />
          ))}
      </div>
    </div>
  );
}
