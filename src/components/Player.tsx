import Hls from "hls.js";
import {
  ArrowLeft,
  Captions,
  History,
  Radio as LiveIcon,
  ChevronDown,
  ChevronUp,
  ExternalLink,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openExternal, type StreamHeaders } from "../lib/http";
import { useQuery } from "../lib/query";
import { parseSubtitles, readSubtitleFile, type Cue } from "../lib/subs";
import type { Channel, Program } from "../lib/types";
import { cn, fmtTime, progress } from "../lib/util";
import { STALKER_UA } from "../providers/stalker";
import { useApp, useProvider } from "../store/app";
import { TrackMenu, useTracks } from "./Tracks";
import { ChannelLogo, ProgressBar } from "./ui";
import { VideoSurface, type VideoStatus } from "./VideoSurface";

import { t } from "../lib/i18n";
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
  const toggleFav = useApp((s) => s.toggleFav);
  const favs = useApp((s) => s.favs[s.activeId ?? "_"]);
  const settings = useApp((s) => s.settings);
  const h24 = settings.timeFormat24;
  const provider = useProvider();

  const [url, setUrl] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoStatus>({ state: "loading" });
  const [controls, setControls] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  // "on" = video is playing but the webview decoded no audio at all (usually an AC3/E-AC3/DTS/TrueHD track)
  const [noAudio, setNoAudio] = useState<"off" | "on" | "hidden">("off");
  const [time, setTime] = useState({ t: 0, d: 0 });
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [nonce, setNonce] = useState(0);
  const [zap, setZap] = useState<string>("");
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [hls, setHls] = useState<Hls | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [ext, setExt] = useState<{ name: string; cues: Cue[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);
  const hideT = useRef<number | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef(false);
  menuRef.current = menu;

  const live = req?.type === "live";
  const channel: Channel | undefined = live && req?.channels && req.index != null ? req.channels[req.index] : undefined;
  const histKey = req ? `${req.type}:${req.stream}` : "";
  // Read the saved position ONCE per title. It must not follow later history
  // updates (we save every 10s), otherwise the video reloads and loops.
  const resumeAt = useMemo(
    () => {
      if (live || !histKey) return undefined;
      const s = useApp.getState();
      const h = s.history[s.activeId ?? "_"]?.find((x) => x.key === histKey);
      // near the end? start over instead of resuming the credits
      return h?.position && h.duration && h.position > h.duration - 30 ? undefined : h?.position;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [histKey, live],
  );
  const headers: StreamHeaders = {
    ua: req?.ua ?? (provider?.kind === "stalker" ? STALKER_UA : undefined),
    referer: req?.referer,
  };

  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    setVideoEl(el);
  }, []);

  const tracks = useTracks(videoEl, hls, ext, offset, settings.subLang, url);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  };

  // reset per item
  useEffect(() => {
    setExt(null);
    setOffset(0);
    setMenu(false);
  }, [req?.stream]);

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
    hideT.current = window.setTimeout(() => !menuRef.current && setControls(false), 3500);
  }, []);

  const zapTo = useCallback(
    (delta: number) => {
      if (!req?.channels || req.index == null) return;
      const n = req.channels.length;
      const index = (req.index + delta + n) % n;
      const ch = req.channels[index];
      play({ ...req, index, title: ch.name, stream: ch.stream, poster: ch.logo, ua: ch.ua, referer: ch.referer });
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
  /** what is still buffered / seekable behind the live edge (the timeshift window) */
  const liveWindow = () => {
    const v = video.current;
    if (!v) return null;
    const r = v.seekable.length ? v.seekable : v.buffered;
    if (!r.length) return null;
    const start = r.start(0);
    const edge = r.end(r.length - 1);
    return Number.isFinite(edge) ? { start, edge } : null;
  };
  const seekLive = (d: number) => {
    const v = video.current;
    const w = liveWindow();
    if (!v || !w) return;
    v.currentTime = Math.max(w.start + 0.5, Math.min(w.edge - 1, v.currentTime + d));
  };
  const goLive = () => {
    if (req?.liveReturn) return play(req.liveReturn);
    const v = video.current;
    const w = liveWindow();
    if (v && w) {
      v.currentTime = Math.max(w.start, w.edge - 2);
      v.play().catch(() => {});
    }
  };
  /** catch-up archive: restart the current programme from its beginning */
  const startOver = async (prog: Program) => {
    if (!channel || !provider?.catchupUrl || !req) return;
    try {
      const u = await provider.catchupUrl(channel, prog);
      play({ title: channel.name, subtitle: t("{0} · desde o início", { 0: prog.title }), stream: u, type: "url", poster: channel.logo, ua: channel.ua, referer: channel.referer, liveReturn: req });
    } catch {
      flash(t("Este canal não tem arquivo para este programa"));
    }
  };

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen().catch(() => {});
  };

  const external = async () => {
    if (!url || !req) return;
    try {
      video.current?.pause();
      const used = await openExternal(url, req.title, headers, settings.externalPlayer);
      flash(t("A abrir em {0}", { 0: used.split(/[\\/]/).pop() }));
    } catch (e) {
      flash(String(e));
    }
  };

  const loadSubFile = async (file: File) => {
    try {
      const text = await readSubtitleFile(file);
      const cues = parseSubtitles(text, file.name);
      if (!cues.length) return flash(t("Ficheiro de legendas sem entradas reconhecidas"));
      setOffset(0);
      setExt({ name: file.name, cues });
      flash(t("Legendas carregadas: {0}", { 0: file.name }));
    } catch {
      flash(t("Não foi possível ler o ficheiro de legendas"));
    }
  };

  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  useEffect(() => {
    if (video.current) video.current.volume = volume;
  }, [volume, url]);

  // detect silent playback: Chromium counts the audio bytes it decoded; 0 while the picture moves = no usable audio track
  useEffect(() => {
    setNoAudio("off");
    if (!url) return;
    let strikes = 0;
    const id = setInterval(() => {
      const v = video.current as (HTMLVideoElement & { webkitAudioDecodedByteCount?: number }) | null;
      if (!v || typeof v.webkitAudioDecodedByteCount !== "number") return;
      if (v.paused || v.seeking || v.readyState < 3 || v.currentTime < 3) return;
      if (v.webkitAudioDecodedByteCount > 0) {
        strikes = 0;
        setNoAudio((s) => (s === "on" ? "off" : s));
      } else if (++strikes >= 2) {
        setNoAudio((s) => (s === "off" ? "on" : s));
      }
    }, 1500);
    return () => clearInterval(id);
  }, [url, nonce]);

  // keyboard
  useEffect(() => {
    if (!req) return;
    poke();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "range") return;
      poke();
      if (menuRef.current) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          setMenu(false);
        }
        return; // arrows navigate inside the menu
      }
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
        case "c":
        case "C":
          setMenu((m) => !m);
          break;
        case "g":
          setOffset((o) => Math.round((o - 0.1) * 10) / 10);
          break;
        case "h":
          setOffset((o) => Math.round((o + 0.1) * 10) / 10);
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
          e.preventDefault();
          e.stopPropagation();
          if (live) seekLive(-10);
          else seek(-10);
          break;
        case "ArrowRight":
          e.preventDefault();
          e.stopPropagation();
          if (live) seekLive(10);
          else seek(10);
          break;
        case "l":
        case "L":
          goLive();
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
  const subsOn = tracks.subs.some((s) => s.active);
  const win = live ? liveWindow() : null;
  const behind = win ? Math.max(0, win.edge - time.t) : 0;
  const delayed = live && behind > 6;
  const canStartOver = !!(live && channel?.catchup && cur && provider?.catchupUrl);

  return (
    <div
      ref={root}
      data-focus-scope
      data-player
      className={cn("fixed inset-0 z-50 bg-black", !controls && "cursor-none")}
      style={{ ["--sub-scale" as string]: settings.subSize / 100, ["--sub-bg" as string]: settings.subBackground ? "rgba(0,0,0,0.62)" : "transparent" }}
      onMouseMove={poke}
      onClick={poke}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) loadSubFile(f);
      }}
    >
      <VideoSurface
        ref={attachVideo}
        key={`${url}-${nonce}`}
        url={url}
        live={live}
        muted={muted}
        headers={headers}
        startAt={resumeAt}
        onStatus={setStatus}
        onTime={(t, d) => setTime({ t, d })}
        onHls={setHls}
      />

      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt,.ass,.ssa,.sub,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadSubFile(f);
          e.target.value = "";
        }}
      />

      {/* loading / error */}
      {!err && status.state === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="size-14 animate-spin text-sky-300 drop-shadow-lg" />
        </div>
      )}
      {noAudio === "on" && !err && (
        <div className="absolute top-20 left-1/2 z-20 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl border border-amber-300/30 bg-black/80 px-4 py-3 text-sm backdrop-blur">
          <VolumeX className="size-5 shrink-0 text-amber-300" />
          <span className="text-sky-50/90">{t("Sem áudio: este ficheiro pode usar um formato de áudio (AC3, DTS…) que a app não consegue reproduzir.")}</span>
          {url && (
            <button className="focusable inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-sky-500 px-3 text-xs font-semibold" onClick={external}>
              <ExternalLink className="size-4" /> {t("Abrir no VLC / mpv")}
            </button>
          )}
          <button className="focusable shrink-0 rounded-lg px-2 py-1 text-xs text-sky-100/60 hover:text-white" onClick={() => setNoAudio("hidden")}>
            {t("Fechar")}
          </button>
        </div>
      )}
      {err && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/70">
          <div className="glass max-w-lg rounded-2xl p-6 text-center">
            <div className="mb-1 text-lg font-bold">{t("Não foi possível reproduzir")}</div>
            <div className="mb-1 text-sm text-sky-100/75">{err}</div>
            {status.engine && <div className="mb-5 text-[11px] text-sky-100/35">{t("Último motor tentado:")} {status.engine}</div>}
            <div className="flex flex-wrap justify-center gap-2">
              <button className="focusable inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-sm font-semibold" onClick={() => setNonce((n) => n + 1)} autoFocus>
                <RefreshCw className="size-4" /> {t("Tentar de novo")}
              </button>
              {url && (
                <button className="focusable inline-flex h-10 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/10" onClick={external}>
                  <ExternalLink className="size-4" /> {t("Abrir no VLC / mpv")}
                </button>
              )}
              <button className="focusable h-10 rounded-xl border border-white/20 px-4 text-sm font-semibold hover:bg-white/10" onClick={close}>
                {t("Voltar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {zap && <div className="absolute top-8 right-10 rounded-2xl bg-black/70 px-6 py-3 text-5xl font-black tabular-nums backdrop-blur">{zap}</div>}
      {toast && <div className="absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-xl bg-black/75 px-4 py-2 text-sm font-semibold backdrop-blur animate-fade-up">{toast}</div>}

      {/* chrome */}
      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-300", controls || menu ? "opacity-100" : "opacity-0")}>
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
          {live &&
            (delayed ? (
              <button onClick={goLive} title={t("Voltar ao direto (L)")} className="focusable flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-0.5 text-xs font-black tracking-widest hover:bg-rose-600">
                <span className="size-1.5 rounded-full bg-white/60" /> −{fmtDur(behind)}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-md bg-rose-600 px-2 py-0.5 text-xs font-black tracking-widest">
                <span className="size-1.5 animate-pulse rounded-full bg-white" /> {t("AO VIVO")}
              </span>
            ))}
          {req.liveReturn && (
            <button onClick={goLive} className="focusable flex items-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-black tracking-wide hover:bg-rose-500">
              <LiveIcon className="size-4" /> {t("Voltar ao direto")}
            </button>
          )}
          {channel && (
            <button onClick={() => toggleFav("live", channel)} className="focusable grid size-11 place-items-center rounded-xl bg-white/10 backdrop-blur hover:bg-white/20" title={t("Favorito")}>
              <Star className={cn("size-5", fav && "fill-amber-300 text-amber-300")} />
            </button>
          )}
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-6 pt-20 pb-5">
          {live && cur && (
            <div className="mb-4 flex items-end gap-6">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-bold tracking-widest text-sky-300 uppercase">{t("A dar agora")}</div>
                <div className="truncate text-lg font-bold">{cur.title}</div>
                <div className="mt-2 flex items-center gap-3 text-xs text-sky-100/70 tabular-nums">
                  {fmtTime(cur.start, h24)}
                  <ProgressBar value={progress(cur)} className="w-80" />
                  {fmtTime(cur.end, h24)}
                </div>
              </div>
              {next && (
                <div className="hidden max-w-xs min-w-0 md:block">
                  <div className="mb-1 text-xs font-bold tracking-widest text-sky-100/50 uppercase">{t("A seguir ·")} {fmtTime(next.start, h24)}</div>
                  <div className="truncate font-semibold text-sky-50/90">{next.title}</div>
                </div>
              )}
            </div>
          )}

          {live && win && win.edge - win.start > 15 && (
            <div className="mb-3 flex items-center gap-3 text-xs text-sky-100/80 tabular-nums">
              <span className="w-14">−{fmtDur(win.edge - win.start)}</span>
              <input
                type="range"
                min={win.start}
                max={win.edge}
                step={1}
                value={Math.min(time.t, win.edge)}
                onChange={(e) => video.current && (video.current.currentTime = Number(e.target.value))}
                className="focusable h-1 flex-1 cursor-pointer accent-sky-400"
                title={t("Recuar no direto")}
                data-nav-ignore
              />
              <button onClick={goLive} disabled={!delayed} className={cn("focusable rounded-md px-2 py-0.5 font-black tracking-wider", delayed ? "bg-white/15 hover:bg-rose-600" : "bg-rose-600")}>
                {t("AO VIVO")}
              </button>
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
                <CtrlBtn onClick={() => zapTo(-1)} title={t("Canal anterior")}>
                  <ChevronUp className="size-5" />
                </CtrlBtn>
                <CtrlBtn onClick={() => zapTo(1)} title={t("Canal seguinte")}>
                  <ChevronDown className="size-5" />
                </CtrlBtn>
              </>
            )}
            <CtrlBtn onClick={() => (live ? seekLive(-10) : seek(-10))} title={live ? t("Recuar 10s no direto (←)") : "-10s"}>
              <RotateCcw className="size-5" />
            </CtrlBtn>
            <button onClick={togglePlay} className="focusable grid size-14 place-items-center rounded-full bg-white text-ink-900 shadow-xl hover:scale-105" autoFocus>
              {status.state === "paused" ? <Play className="size-6 fill-current" /> : <Pause className="size-6 fill-current" />}
            </button>
            <CtrlBtn onClick={() => (live ? seekLive(10) : seek(10))} title={live ? t("Avançar 10s (→)") : "+10s"}>
              <RotateCw className="size-5" />
            </CtrlBtn>
            {canStartOver && (
              <button
                onClick={() => startOver(cur!)}
                title={t("Ver o programa atual desde o início (arquivo do canal)")}
                className="focusable ml-1 flex h-11 items-center gap-2 rounded-xl bg-white/10 px-3.5 text-sm font-semibold backdrop-blur transition hover:bg-white/20"
              >
                <History className="size-4" /> {t("Desde o início")}
              </button>
            )}
            <div className="flex-1" />
            <div className="relative">
              <CtrlBtn onClick={() => setMenu((m) => !m)} title={t("Legendas e áudio (C)")} active={subsOn || menu}>
                <Captions className="size-5" />
              </CtrlBtn>
              {menu && (
                <TrackMenu
                  tracks={tracks}
                  ext={ext}
                  offset={offset}
                  onOffset={setOffset}
                  onLoadFile={() => fileInput.current?.click()}
                  onClearFile={() => setExt(null)}
                  onClose={() => setMenu(false)}
                />
              )}
            </div>
            {url && (
              <CtrlBtn onClick={external} title={t("Abrir no VLC / mpv")}>
                <ExternalLink className="size-5" />
              </CtrlBtn>
            )}
            <CtrlBtn onClick={() => setMuted((m) => !m)} title={t("Som (M)")}>
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
            <CtrlBtn onClick={toggleFull} title={t("Ecrã inteiro (F)")}>
              {full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}
            </CtrlBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlBtn({ children, onClick, title, active }: { children: React.ReactNode; onClick: () => void; title?: string; active?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={cn("focusable grid size-11 place-items-center rounded-xl backdrop-blur transition", active ? "bg-sky-500/80 hover:bg-sky-500" : "bg-white/10 hover:bg-white/20")}>
      {children}
    </button>
  );
}
