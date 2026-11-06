import { Columns2, Grid2x2, Plus, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChannelLogo, Empty, ScreenHeader, SearchBox, Spinner } from "../components/ui";
import { VideoSurface } from "../components/VideoSurface";
import { useQuery } from "../lib/query";
import type { Channel } from "../lib/types";
import { cn } from "../lib/util";
import { STALKER_UA } from "../providers/stalker";
import { useProfile, useProvider } from "../store/app";

export function Multi() {
  const [layout, setLayout] = useState<2 | 4>(4);
  const [slots, setSlots] = useState<(Channel | null)[]>([null, null, null, null]);
  const [audio, setAudio] = useState(0);
  const [picking, setPicking] = useState<number | null>(null);

  const setSlot = (i: number, ch: Channel | null) => setSlots((s) => s.map((x, j) => (j === i ? ch : x)));

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Multi-ecrã" icon={<Grid2x2 className="size-5" />}>
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          <button onClick={() => setLayout(2)} className={cn("focusable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", layout === 2 ? "bg-white/15" : "text-sky-100/55")}>
            <Columns2 className="size-4" /> 2 ecrãs
          </button>
          <button onClick={() => setLayout(4)} className={cn("focusable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", layout === 4 ? "bg-white/15" : "text-sky-100/55")}>
            <Grid2x2 className="size-4" /> 4 ecrãs
          </button>
        </div>
        <span className="text-xs text-sky-100/45">Clica num ecrã para ouvir o som dele.</span>
      </ScreenHeader>
      <div className={cn("grid min-h-0 flex-1 gap-2 bg-black p-2", layout === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-2")}>
        {slots.slice(0, layout).map((ch, i) => (
          <Slot key={i} ch={ch} active={audio === i} onActivate={() => setAudio(i)} onPick={() => setPicking(i)} onClear={() => setSlot(i, null)} />
        ))}
      </div>
      {picking != null && (
        <Picker
          onClose={() => setPicking(null)}
          onPick={(ch) => {
            setSlot(picking, ch);
            setAudio(picking);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function Slot({ ch, active, onActivate, onPick, onClear }: { ch: Channel | null; active: boolean; onActivate: () => void; onPick: () => void; onClear: () => void }) {
  const provider = useProvider()!;
  const profile = useProfile()!;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!ch) return;
    let alive = true;
    provider.resolve(ch.stream, "live").then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [ch, provider]);

  if (!ch)
    return (
      <button onClick={onPick} className="focusable flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/15 bg-ink-900/60 text-sky-100/60 transition hover:border-sky-400/60 hover:text-white">
        <Plus className="size-10" />
        <span className="text-sm font-semibold">Adicionar canal</span>
      </button>
    );

  return (
    <div className={cn("group relative overflow-hidden rounded-xl ring-2 transition", active ? "ring-sky-400" : "ring-transparent")}>
      <button onClick={onActivate} onDoubleClick={onPick} className="focusable absolute inset-0 z-0">
        <VideoSurface url={url} live muted={!active} ua={profile.kind === "stalker" ? STALKER_UA : undefined} />
      </button>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
        <ChannelLogo src={ch.logo} name={ch.name} className="size-8" />
        <span className="flex-1 truncate text-sm font-bold">{ch.name}</span>
        {active ? <Volume2 className="size-4 text-sky-300" /> : <VolumeX className="size-4 text-white/50" />}
        <button onClick={onPick} className="pointer-events-auto rounded-lg bg-white/15 px-2 py-1 text-xs font-bold hover:bg-white/25">
          Trocar
        </button>
        <button onClick={onClear} className="pointer-events-auto grid size-7 place-items-center rounded-lg bg-white/15 hover:bg-rose-500/60">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

function Picker({ onPick, onClose }: { onPick: (c: Channel) => void; onClose: () => void }) {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const [q, setQ] = useState("");
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());
  const list = useMemo(() => (all.data ?? []).filter((c) => !c.isRadio && (!q || c.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 200), [all.data, q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div data-focus-scope className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-8 backdrop-blur-sm" onClick={onClose}>
      <div className="glass flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-white/10 p-4">
          <SearchBox value={q} onChange={setQ} placeholder="Procurar canal…" />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {all.loading && <Spinner />}
          {!all.loading && !list.length && <Empty title="Nenhum canal encontrado" />}
          {list.map((c) => (
            <button key={c.id} onClick={() => onPick(c)} className="focusable flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/[0.07]">
              <span className="w-8 text-right text-xs text-sky-100/40 tabular-nums">{c.num}</span>
              <ChannelLogo src={c.logo} name={c.name} className="size-9" />
              <span className="truncate text-sm font-semibold">{c.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
