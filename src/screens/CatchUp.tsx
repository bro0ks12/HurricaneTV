import { History, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { ChannelLogo, Empty, Pill, ScreenHeader, SearchBox, Spinner } from "../components/ui";
import { useQuery } from "../lib/query";
import type { Channel, Program } from "../lib/types";
import { cn, fmtDay, fmtTime } from "../lib/util";
import { useApp, useProfile, useProvider } from "../store/app";

export function CatchUp() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Channel | null>(null);
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());
  const channels = useMemo(
    () => (all.data ?? []).filter((c) => c.catchup && (!q || c.name.toLowerCase().includes(q.toLowerCase()))),
    [all.data, q],
  );

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Catch Up" icon={<History className="size-5" />}>
        <SearchBox value={q} onChange={setQ} placeholder="Pesquisar canal…" className="w-80" />
        <Pill tone="slate">{channels.length} canais com arquivo</Pill>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-white/10 bg-ink-950/35 p-2">
          {all.loading && <Spinner />}
          {!all.loading && !channels.length && <Empty title="Sem canais com arquivo" hint="O teu fornecedor não disponibiliza catch-up nestes canais." />}
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSel(ch)}
              className={cn("focusable flex w-full items-center gap-3 rounded-xl p-2 text-left transition", sel?.id === ch.id ? "bg-gradient-to-r from-sky-500/35 to-blue-600/15 ring-1 ring-sky-400/50" : "hover:bg-white/[0.06]")}
            >
              <ChannelLogo src={ch.logo} name={ch.name} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{ch.name}</span>
                {ch.catchupDays ? <span className="text-[11px] text-emerald-300/80">{ch.catchupDays} dias de arquivo</span> : null}
              </span>
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-6">{sel ? <Archive ch={sel} /> : <Empty icon={<History className="size-6" />} title="Escolhe um canal" hint="Vê programas que já passaram nos últimos dias." />}</div>
      </div>
    </div>
  );
}

function Archive({ ch }: { ch: Channel }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const h24 = useApp((s) => s.settings.timeFormat24);
  const arch = useQuery(`archive:${ch.id}`, () => (provider.archive ? provider.archive(ch) : Promise.resolve([] as Program[])));

  const groups = useMemo(() => {
    const m = new Map<string, Program[]>();
    for (const p of arch.data ?? []) {
      const k = fmtDay(p.start);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m];
  }, [arch.data]);

  const open = async (p: Program) => {
    const url = await provider.catchupUrl!(ch, p);
    play({ title: ch.name, subtitle: `${p.title} · ${fmtDay(p.start)} ${fmtTime(p.start, h24)}`, stream: url, type: "url", poster: ch.logo });
  };

  if (arch.loading) return <Spinner label="A carregar arquivo…" />;
  if (arch.error) return <Empty title="Erro" hint={arch.error} />;
  if (!groups.length) return <Empty icon={<History className="size-6" />} title="Arquivo vazio" hint="Não há programas disponíveis para este canal." />;

  return (
    <div className="space-y-6">
      {groups.map(([day, list]) => (
        <section key={day}>
          <div className="sticky top-0 z-10 -mx-2 mb-2 bg-ink-900/80 px-2 py-1.5 text-sm font-bold text-sky-200 capitalize backdrop-blur">{day}</div>
          <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
            {list.map((p, i) => (
              <button key={i} onClick={() => open(p)} className="focusable group flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 text-left transition hover:bg-white/[0.09]">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-200 transition group-hover:bg-sky-400 group-hover:text-white">
                  <Play className="size-4 fill-current" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-sky-100/50 tabular-nums">
                    {fmtTime(p.start, h24)} – {fmtTime(p.end, h24)}
                  </div>
                  <div className="truncate text-sm font-semibold">{p.title}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
