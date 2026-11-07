import { Clapperboard, Film, Search as SearchIcon, Tv } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { ChannelLogo, Empty, Poster, ScreenHeader, SearchBox } from "../components/ui";
import { useParental } from "../lib/parental";
import { useQuery } from "../lib/query";
import { useApp, useProfile, useProvider } from "../store/app";

import { t } from "../lib/i18n";
export function Search() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const go = useApp((s) => s.go);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());

  const live = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());
  // Stalker vod "all" is paginated & slow; only search what's cheap
  const vod = useQuery(profile.kind === "stalker" ? null : `vod-items:${profile.id}:all`, () => provider.vodItems());
  const series = useQuery(profile.kind === "stalker" ? null : `series-items:${profile.id}:all`, () => provider.seriesItems());

  const cheap = profile.kind !== "stalker";
  const liveCats = useQuery(`live-cats:${profile.id}`, () => provider.liveCategories());
  const vodCats = useQuery(cheap ? `vod-cats:${profile.id}` : null, () => provider.vodCategories());
  const seriesCats = useQuery(cheap ? `series-cats:${profile.id}` : null, () => provider.seriesCategories());
  const pL = useParental("live", liveCats.data);
  const pV = useParental("vod", vodCats.data);
  const pS = useParental("series", seriesCats.data);
  const res = useMemo(() => {
    if (dq.length < 2) return null;
    const f = <T extends { name: string }>(l?: T[]) => (l ?? []).filter((x) => x.name.toLowerCase().includes(dq)).slice(0, 30);
    const ok = (hidden: Set<string>) => (x: { categoryId?: string }) => !hidden.has(x.categoryId ?? "");
    return { live: f(live.data?.filter(ok(pL.hidden))), vod: f(vod.data?.filter(ok(pV.hidden))), series: f(series.data?.filter(ok(pS.hidden))) };
  }, [dq, live.data, vod.data, series.data, pL.hidden, pV.hidden, pS.hidden]);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("Pesquisar")} icon={<SearchIcon className="size-5" />}>
        <div className="w-[480px]" onFocus={(e) => e.currentTarget.querySelector("input")?.select()}>
          <SearchBox value={q} onChange={setQ} placeholder={t("Canais, filmes e séries…")} />
        </div>
      </ScreenHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {!res ? (
          <Empty icon={<SearchIcon className="size-6" />} title={t("Pesquisa em todo o catálogo")} hint={t("Escreve pelo menos 2 letras.")} />
        ) : !res.live.length && !res.vod.length && !res.series.length ? (
          <Empty title={t("Sem resultados")} hint={t("Nada encontrado para «{0}».", { 0: q })} />
        ) : (
          <div className="space-y-8">
            {res.live.length > 0 && (
              <Group icon={<Tv className="size-4" />} title={t("Canais")}>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                  {res.live.map((c, i) => (
                    <button key={c.id} onClick={() => play({ title: c.name, stream: c.stream, type: "live", channels: res.live, index: i, poster: c.logo, ua: c.ua, referer: c.referer })} className="focusable glass flex items-center gap-3 rounded-xl p-2.5 text-left hover:bg-white/10">
                      <ChannelLogo src={c.logo} name={c.name} className="size-10" />
                      <span className="truncate text-sm font-semibold">{c.name}</span>
                    </button>
                  ))}
                </div>
              </Group>
            )}
            {res.vod.length > 0 && (
              <Group icon={<Film className="size-4" />} title={t("Filmes")}>
                <Row items={res.vod} onClick={(it) => play({ title: it.name, stream: (it as { stream: string }).stream, type: "vod", poster: it.poster, ua: (it as { ua?: string }).ua, referer: (it as { referer?: string }).referer })} />
              </Group>
            )}
            {res.series.length > 0 && (
              <Group icon={<Clapperboard className="size-4" />} title={t("Séries")}>
                <Row items={res.series} onClick={() => go("series")} />
              </Group>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-sky-200">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Row<T extends { id: string; name: string; poster?: string }>({ items, onClick }: { items: T[]; onClick: (it: T) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {items.map((it) => (
        <button key={it.id} onClick={() => onClick(it)} className="focusable w-36 shrink-0 rounded-xl text-left">
          <Poster src={it.poster} name={it.name} className="aspect-[2/3] rounded-xl ring-1 ring-white/10" />
          <div className="mt-1.5 truncate text-[13px] font-semibold">{it.name}</div>
        </button>
      ))}
    </div>
  );
}
