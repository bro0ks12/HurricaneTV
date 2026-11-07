import { Columns2, Grid2x2, Minus, Plus, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ChannelLogo, Empty, ScreenHeader, SearchBox, Spinner } from "../components/ui";
import { VideoSurface } from "../components/VideoSurface";
import { useQuery } from "../lib/query";
import type { Channel } from "../lib/types";
import { cn } from "../lib/util";
import { STALKER_UA } from "../providers/stalker";
import { useProfile, useProvider } from "../store/app";

import { t } from "../lib/i18n";
const STEP = 0.1;
const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;

export function Multi() {
  const [layout, setLayout] = useState<2 | 4>(4);
  const [slots, setSlots] = useState<(Channel | null)[]>([null, null, null, null]);
  /** screen whose sound is on; null = everything muted */
  const [audio, setAudio] = useState<number | null>(0);
  const [lastAudio, setLastAudio] = useState(0);
  const [volumes, setVolumes] = useState([0.8, 0.8, 0.8, 0.8]);
  const [picking, setPicking] = useState<number | null>(null);

  const setSlot = (i: number, ch: Channel | null) => setSlots((s) => s.map((x, j) => (j === i ? ch : x)));
  const setVol = (i: number, v: number) => setVolumes((a) => a.map((x, j) => (j === i ? clamp(v) : x)));
  const listen = (i: number) => {
    setAudio(i);
    setLastAudio(i);
  };
  const toggleAll = () => setAudio((a) => (a == null ? lastAudio : null));

  // keyboard: M mutes everything, +/- change the volume of the screen being heard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || picking != null) return;
      if (e.key === "m" || e.key === "M") toggleAll();
      else if (audio != null && (e.key === "+" || e.key === "=")) setVol(audio, volumes[audio] + STEP);
      else if (audio != null && (e.key === "-" || e.key === "_")) setVol(audio, volumes[audio] - STEP);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const allMuted = audio == null;

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("Multi-ecrã")} icon={<Grid2x2 className="size-5" />}>
        <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
          <button onClick={() => setLayout(2)} className={cn("focusable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", layout === 2 ? "bg-white/15" : "text-sky-100/55")}>
            <Columns2 className="size-4" /> {t("2 ecrãs")}
          </button>
          <button onClick={() => setLayout(4)} className={cn("focusable flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", layout === 4 ? "bg-white/15" : "text-sky-100/55")}>
            <Grid2x2 className="size-4" /> {t("4 ecrãs")}
          </button>
        </div>
        <button
          onClick={toggleAll}
          title={t("Silenciar todos (M)")}
          className={cn(
            "focusable flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-bold transition",
            allMuted ? "border-rose-400/40 bg-rose-500/15 text-rose-200" : "border-white/10 bg-white/5 text-sky-100/70 hover:text-white",
          )}
        >
          {allMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          {allMuted ? t("Tudo silenciado") : t("Silenciar todos")}
        </button>
        <span className="text-xs text-sky-100/45">{t("Clica num ecrã para ouvir/silenciar · + / − ajustam o volume")}</span>
      </ScreenHeader>
      <div className={cn("grid min-h-0 flex-1 gap-2 bg-black p-2", layout === 2 ? "grid-cols-2 grid-rows-1" : "grid-cols-2 grid-rows-2")}>
        {slots.slice(0, layout).map((ch, i) => (
          <Slot
            key={i}
            ch={ch}
            active={audio === i}
            volume={volumes[i]}
            onVolume={(v) => {
              setVol(i, v);
              if (audio !== i) listen(i);
            }}
            onActivate={() => (audio === i ? setAudio(null) : listen(i))}
            onPick={() => setPicking(i)}
            onClear={() => {
              setSlot(i, null);
              if (audio === i) setAudio(null);
            }}
          />
        ))}
      </div>
      {picking != null && (
        <Picker
          onClose={() => setPicking(null)}
          onPick={(ch) => {
            setSlot(picking, ch);
            // keep "everything muted" if the user chose it; otherwise hear the new channel
            if (audio != null || slots.every((x) => !x)) listen(picking);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function Slot({
  ch,
  active,
  volume,
  onVolume,
  onActivate,
  onPick,
  onClear,
}: {
  ch: Channel | null;
  active: boolean;
  volume: number;
  onVolume: (v: number) => void;
  onActivate: () => void;
  onPick: () => void;
  onClear: () => void;
}) {
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
        <span className="text-sm font-semibold">{t("Adicionar canal")}</span>
      </button>
    );

  const VolIcon = !active || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className={cn("group relative overflow-hidden rounded-xl ring-2 transition", active ? "ring-sky-400" : "ring-transparent")}>
      <button onClick={onActivate} onDoubleClick={onPick} title={active ? t("Clica para silenciar") : t("Clica para ouvir")} className="focusable absolute inset-0 z-0">
        <VideoSurface url={url} live muted={!active} volume={volume} headers={{ ua: ch.ua ?? (profile.kind === "stalker" ? STALKER_UA : undefined), referer: ch.referer }} />
      </button>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
        <ChannelLogo src={ch.logo} name={ch.name} className="size-8" />
        <span className="flex-1 truncate text-sm font-bold">{ch.name}</span>
        <button onClick={onPick} className="pointer-events-auto rounded-lg bg-white/15 px-2 py-1 text-xs font-bold hover:bg-white/25">
          {t("Trocar")}
        </button>
        <button onClick={onClear} className="pointer-events-auto grid size-7 place-items-center rounded-lg bg-white/15 hover:bg-rose-500/60">
          <X className="size-4" />
        </button>
      </div>

      {/* sound bar: always visible on the screen you hear, on hover for the others */}
      <div
        className={cn(
          "absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-xl bg-black/65 p-1.5 pr-3 backdrop-blur-md transition",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onActivate}
          title={active ? t("Silenciar este ecrã") : t("Ouvir este ecrã")}
          className={cn("grid size-8 place-items-center rounded-lg transition", active ? "bg-sky-400 text-ink-950" : "bg-white/10 text-white/70 hover:bg-white/20")}
        >
          <VolIcon className="size-4" />
        </button>
        <button onClick={() => onVolume(volume - STEP)} title={t("Baixar volume")} className="grid size-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <Minus className="size-3.5" />
        </button>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onVolume(Number(e.target.value))} className="w-24 accent-sky-400" data-nav-ignore />
        <button onClick={() => onVolume(volume + STEP)} title={t("Subir volume")} className="grid size-8 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
          <Plus className="size-3.5" />
        </button>
        <span className="w-9 text-right text-xs font-bold text-sky-100/80 tabular-nums">{Math.round(volume * 100)}%</span>
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
          <SearchBox value={q} onChange={setQ} placeholder={t("Procurar canal…")} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {all.loading && <Spinner />}
          {!all.loading && !list.length && <Empty title={t("Nenhum canal encontrado")} />}
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
