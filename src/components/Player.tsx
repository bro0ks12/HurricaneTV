import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "../lib/query";
import type { Channel } from "../lib/types";
import { cn, fmtTime, progress } from "../lib/util";
import { STALKER_UA } from "../providers/stalker";
import { useApp, useProvider } from "../store/app";
import { ChannelLogo, ProgressBar } from "./ui";
import { VideoSurface, type VideoStatus } from "./VideoSurface";

const fmtDur = (s: number) => {
  if (!Number.isFinite(s)) return "--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(sec).padStart(2, "0")}`;
};

export function Player() {
  const req = useApp((s) => s.playing);
  const play = useApp((s) => s.play);
  const pushHistory = useApp((s) => s.pushHistory);
  const history = useApp((s) => s.history[s.activeId ?? "_"]);
  const toggleFav = useApp((s) => s.toggleFav);
  const favs = useApp((s) => s.favs[s.activeId ?? "_"]);
  const h24 = useApp((s) => s.settings.timeFormat24);
  const provider = useProvider();

  const [url, setUrl] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoStatus>({ state: "loading" });
  const [controls, setControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [nonce, setNonce] = useState(0);
  const [zap, setZap] = useState<string>("");
  const video = useRef<HTMLVideoElement | null>(null);
  const hideT = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  const live = req?.type === "live";
  const channel: Channel | undefined = live && req?.channels && req.index != null ? req.channels[req.index] : undefined;
  const histKey = req ? `${req.type}:${req.stream}` : "";
  const resumeAt = !live && req ? history?.find((h) => h.key === histKey)?.position : undefined;

  // Resolve the stream url (Stalker needs a create_link call, Xtream picks .ts/.m3u8)
  useEffect(() => {
    if (!req || !provider) return;
    let alive = true;
    setUrl(null);
    setResolveErr(null);
    setStatus({ state: "loading" });
    const p = req.type === "url" ? Promise.resolve(req.stream) : provider.resolve(req.stream, req.type);
    p.then((u) => alive && setUrl(u)).catch((e) => alive && setResolveErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [req, provider, nonce]);

  // history entry
  useEffect(() => {
    if (!req) return;
    pushHistory({ key: histKey, title: req.title, poster: req.poster, play: { ...req, channels: undefined }, at: Date.now(), position: resumeAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const savePos = useCallback(() => {
    const v = video.current;
    if (!req || live || !v || !v.duration) return;
    pushHistory({ key: histKey, title: req.title, poster: req.poster, play: { ...req, channels: undefined }, at: Date.now(), position: v.currentTime, duration: v.duration });
  }, [req, live, histKey, pushHistory]);

  useEffect(() => {
    const t = setInterval(savePos, 10_000);
    return () => clearInterval(t);
  }, [savePos]);

  const close = useCallback(() => {
    savePos();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    play(null);
  }, [savePos, play]);

  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideT.current);
    hideT.current = window.setTimeout(() => setControls(false), 3500);
  }, []);

  const zapTo = useCallback(
    (delta: number) => {
      if (!req?.channels || req.index == null) return;
      const n = req.channels.length;
      const index = (req.index + delta + n) % n;
      const ch = req.channels[index];
      play({ ...req, index, title: ch.name, stream: ch.stream, poster: ch.logo });
    },
    [req, play],
  );

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const seek = (d: number) => {
    const v = video.current;
    if (v && Number.isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + d));
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume, url]);

  // keyboard
  useEffect(() => {
    if (!req) return;
    poke();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "range") return;
      poke();
      if (live && /^\d$/.test(e.key)) {
        setZap((z) => (z + e.key).slice(-4));
        return;
      }
      switch (e.key) {
        case "Escape":
        case "Backspace":
          e.preventDefault();
          e.stopPropagation();
          close();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "f":
        case "F":
          toggleFull();
          break;
        case "m":
        case "M":
          setMuted((m) => !m);
          break;
        case "ArrowUp":
        case "PageUp":
          if (live) {
            e.preventDefault();
            e.stopPropagation();
            zapTo(-1);
          }
          break;
        case "ArrowDown":
        case "PageDown":
          if (live) {
            e.preventDefault();
            e.stopPropagation();
            zapTo(1);
          }
          break;
        case "ArrowLeft":
          if (!live) {
            e.preventDefault();
            e.stopPropagation();
            seek(-10);
          }
          break;
        case "ArrowRight":
          if (!live) {
            e.preventDefault();
            e.stopPropagation();
            seek(10);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req, live, close, zapTo, poke]);

  // numeric zapping
  useEffect(() => {
    if (!zap || !req?.channels) return;
    const t = setTimeout(() => {
      const idx = req.channels!.findIndex((c) => c.num === Number(zap));
      if (idx >= 0) zapTo(idx - (req.index ?? 0));
      setZap("");
    }, 1200);
    return () => clearTimeout(t);
  }, [zap, req, zapTo]);

  const epg = useQuery(channel && provider ? `epg:${channel.id}` : null, () => provider!.epg(channel!, 3));

  if (!req) return null;
  const now = Date.now();
  const cur = epg.data?.find((p) => p.start <= now && p.end > now);
  const next = epg.data?.find((p) => p.start > now);
  const fav = channel ? favs?.live.some((c) => c.id === channel.id) : false;
  const err = resolveErr || (status.state === "error" ? status.error : null);
  const isStalker = provider?.kind === "stalker";

  return (
    <div
      ref={root}
      data-focus-scope
      className={cn("fixed inset-0 z-50 bg-black", !controls && "cursor-none")}
      onMouseMove={poke}
      onClick={poke}
    >
      <VideoSurface
        ref={video}
        key={`${url}-${nonce}`}
        url={url}
        live={live}
        muted={muted}
        ua={isStalker ? STALKER_UA : undefined}
        startAt={resumeAt}
        onStatus={setStatus}
        onTime={(t, d) => setTime({ t, d })}
      />

      {/* loading / error */}
      {!err && status.state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-14 animate-spin text-sky-300 drop-shadow-lg" />
        </div>
      )}
      {err && (
        <div className="absolute inset-0 grid place-items-center bg-black/70">
          <div className="glass max-w-md rounded-2xl p-6 text-center">
            <div className="mb-1 text-lg font-bold">Não foi possível reproduzir</div>
            <div className="mb-5 text-sm text-sky-100/70">{err}</div>
            <div className="flex justify-center gap-2">
              <button className="focusable inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-sm font-semibold" onClick={() => setNonce((n) => n + 1)} autoFocus>
                <RefreshCw className="size-4" /> Tentar de novo
              </button>
              <button className="focusable h-10 rounded-xl border border-white/20 px-4 text-sm font-semibold" onClick={close}>
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {zap && (
        <div className="absolute top-8 right-10 rounded-2xl bg-black/70 px-6 py-3 text-5xl font-black tabular-nums backdrop-blur">{zap}</div>
      )}

      {/* chrome */}
      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-300", controls ? "opacity-100" : "opacity-0")}>
        <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-4 bg-gradient-to-b from-black/85 to-transparent px-6 pt-5 pb-14">
          <button onClick={close} className="focusable grid size-11 place-items-center rounded-xl bg-white/10 backdrop-blur hover:bg-white/20">
            <ArrowLeft className="size-5" />
          </button>
          {channel && <ChannelLogo src={channel.logo} name={channel.name} className="size-11" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-bold text-shadow">
              {channel?.num ? <span className="mr-2 text-sky-300 tabular-nums">{channel.num}</span> : null}
              {req.title}
            </div>
            {req.subtitle && <div className="truncate text-sm text-sky-100/70">{req.subtitle}</div>}
          </div>
          {live && <span className="rounded-md bg-rose-600 px-2 py-0.5 text-xs font-black tracking-widest">LIVE</span>}
          {channel && (
            <button onClick={() => toggleFav("live", channel)} className="focusable grid size-11 place-items-center rounded-xl bg-white/10 backdrop-blur hover:bg-white/20" title="Favorito">
              <Star className={cn("size-5", fav && "fill-amber-300 text-amber-300")} />
            </button>
          )}
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-6 pt-20 pb-5">
          {live && cur && (
            <div className="mb-4 flex items-end gap-6">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-bold tracking-widest text-sky-300 uppercase">A dar agora</div>
                <div className="truncate text-lg font-bold">{cur.title}</div>
                <div className="mt-2 flex items-center gap-3 text-xs text-sky-100/70 tabular-nums">
                  {fmtTime(cur.start, h24)}
                  <ProgressBar value={progress(cur)} className="w-80" />
                  {fmtTime(cur.end, h24)}
                </div>
              </div>
              {next && (
                <div className="hidden max-w-xs min-w-0 md:block">
                  <div className="mb-1 text-xs font-bold tracking-widest text-sky-100/50 uppercase">A seguir · {fmtTime(next.start, h24)}</div>
                  <div className="truncate font-semibold text-sky-50/90">{next.title}</div>
                </div>
              )}
            </div>
          )}

          {!live && (
            <div className="mb-3 flex items-center gap-3 text-xs text-sky-100/80 tabular-nums">
              <span>{fmtDur(time.t)}</span>
              <input
                type="range"
                min={0}
                max={time.d || 0}
                step={1}
                value={time.t}
                onChange={(e) => video.current && (video.current.currentTime = Number(e.target.value))}
                className="focusable h-1 flex-1 cursor-pointer accent-sky-400"
                data-nav-ignore
              />
              <span>{fmtDur(time.d)}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {live && req.channels && (
              <>
                <CtrlBtn onClick={() => zapTo(-1)} title="Canal anterior">
                  <ChevronUp className="size-5" />
                </CtrlBtn>
                <CtrlBtn onClick={() => zapTo(1)} title="Canal seguinte">
                  <ChevronDown className="size-5" />
                </CtrlBtn>
              </>
            )}
            {!live && (
              <CtrlBtn onClick={() => seek(-10)} title="-10s">
                <RotateCcw className="size-5" />
              </CtrlBtn>
            )}
            <button onClick={togglePlay} className="focusable grid size-14 place-items-center rounded-full bg-white text-ink-900 shadow-xl hover:scale-105" autoFocus>
              {status.state === "paused" ? <Play className="size-6 fill-current" /> : <Pause className="size-6 fill-current" />}
            </button>
            {!live && (
              <CtrlBtn onClick={() => seek(10)} title="+10s">
                <RotateCw className="size-5" />
              </CtrlBtn>
            )}
            <div className="flex-1" />
            <CtrlBtn onClick={() => setMuted((m) => !m)} title="Som (M)">
              {muted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </CtrlBtn>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              className="focusable w-28 accent-sky-400"
              data-nav-ignore
            />
            <CtrlBtn onClick={toggleFull} title="Ecrã inteiro (F)">
              {full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </CtrlBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} className="focusable grid size-11 place-items-center rounded-xl bg-white/10 backdrop-blur transition hover:bg-white/20">
      {children}
    </button>
  );
}
