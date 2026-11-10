import Hls from "hls.js";
import { AudioLines, Captions, Check, FileUp, Image as ImageIcon, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inTauri, mkvCues, mkvTracks, type MkvTrack } from "../lib/http";
import { langMatches, langName, type Cue } from "../lib/subs";
import { cn } from "../lib/util";

import { t as tr } from "../lib/i18n";
const FILE_LABEL = "__hurricane_file__";
const MKV_LABEL = "__hurricane_mkv__";
const OURS = new Set([FILE_LABEL, MKV_LABEL]);
const NO_CUES: Cue[] = [];

export interface Track {
  id: string;
  label: string;
  lang?: string;
  active: boolean;
  /** shown but not selectable (image-based subtitles) */
  disabled?: boolean;
  hint?: string;
}

export interface Tracks {
  subs: Track[];
  audio: Track[];
  selectSub(id: string | null): void;
  selectAudio(id: string): void;
}

const niceLabel = (name: string | undefined, lang: string | undefined, i: number) => {
  const l = langName(lang);
  const n = (name ?? "").trim();
  if (n && l && !n.toLowerCase().includes(l.toLowerCase())) return `${l} · ${n}`;
  return n || l || tr("Faixa {0}", { 0: i + 1 });
};

/* ---------- our own TextTracks (file / mkv), fed incrementally ---------- */

const ownTracks = new WeakMap<HTMLVideoElement, Map<string, TextTrack>>();
function ownTrack(v: HTMLVideoElement, label: string) {
  let m = ownTracks.get(v);
  if (!m) ownTracks.set(v, (m = new Map()));
  let t = m.get(label);
  if (!t) {
    t = v.addTextTrack("subtitles", label, "und");
    t.mode = "disabled";
    m.set(label, t);
  }
  return t;
}

function useCueTrack(video: HTMLVideoElement | null, label: string, source: string | null, cues: Cue[], offset: number, show: boolean) {
  const st = useRef({ key: "", added: new Map<number, VTTCue>() });
  useEffect(() => {
    if (!video) return;
    const t = ownTrack(video, label);
    const key = `${source}|${offset}`;
    if (st.current.key !== key) {
      if (t.mode === "disabled") t.mode = "hidden"; // cues can only be edited when not disabled
      while (t.cues && t.cues.length) t.removeCue(t.cues[0]);
      st.current = { key, added: new Map() };
    }
    if (source) {
      if (t.mode === "disabled") t.mode = "hidden";
      for (const c of cues) {
        const s = c.start + offset;
        const e = c.end + offset;
        if (e <= 0) continue;
        const text = c.text.replace(/\r/g, "");
        // the proxy refines a cue after first reporting it (real duration, merged
        // simultaneous lines), so update the one we already added instead of skipping it
        const have = st.current.added.get(c.start);
        if (have) {
          if (have.endTime !== e) have.endTime = e;
          if (have.text !== text) have.text = text;
          continue;
        }
        try {
          const vc = new VTTCue(Math.max(0, s), e, text);
          // keep the bottom of the cue box ~10% above the edge, whatever the number of lines (default hugs the margin)
          vc.snapToLines = false;
          vc.line = 90;
          vc.lineAlign = "end";
          t.addCue(vc);
          st.current.added.set(c.start, vc);
        } catch {
          /* skip malformed */
        }
      }
    }
    t.mode = show && source ? "showing" : "disabled";
  }, [video, label, source, cues, offset, show]);
}

function nativeTracks(v: HTMLVideoElement) {
  return [...v.textTracks].filter((t) => !OURS.has(t.label) && (t.kind === "subtitles" || t.kind === "captions"));
}
/** CEA-608/708 closed captions hls.js extracts from the video stream */
function ccTracks(v: HTMLVideoElement) {
  return [...v.textTracks].filter((t) => !OURS.has(t.label) && t.kind === "captions");
}

// Chromium only exposes these with --enable-blink-features=AudioVideoTracks (set in tauri.conf.json)
interface NativeAudioTrack {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}
const audioTracksOf = (v: HTMLVideoElement) => (v as unknown as { audioTracks?: ArrayLike<NativeAudioTrack> & EventTarget }).audioTracks;

/**
 * Unifies subtitle/audio tracks from hls.js, in-band native text tracks,
 * subtitles embedded in MKV (extracted by the Rust proxy) and a user-loaded
 * .srt/.vtt/.ass file. Everything renders natively via ::cue.
 */
export function useTracks(
  video: HTMLVideoElement | null,
  hls: Hls | null,
  ext: { name: string; cues: Cue[] } | null,
  offset: number,
  prefLang: string,
  streamUrl: string | null,
): Tracks {
  const [ver, setVer] = useState(0);
  const bump = () => setVer((x) => x + 1);
  /** selected custom source: "file" | "mkv:<n>" | null */
  const [sel, setSel] = useState<string | null>(null);
  const [mkv, setMkv] = useState<MkvTrack[]>([]);
  // cues are tagged with the track they belong to, so a stale list from the
  // previous track can never be fed into the newly selected one
  const [mkvData, setMkvData] = useState<{ track: number; cues: Cue[] } | null>(null);
  const autoPicked = useRef(false);
  // converted playback (ffmpeg) restarts the element's clock at 0 on every seek: cue times must be shifted by where the stream starts
  const [txOff, setTxOff] = useState(0);
  useEffect(() => {
    if (!video) return;
    const read = () => setTxOff((video as HTMLVideoElement & { txOffset?: number }).txOffset ?? 0);
    read();
    video.addEventListener("txoffset", read);
    return () => video.removeEventListener("txoffset", read);
  }, [video]);

  useEffect(() => {
    setSel(null);
    setMkv([]);
    setMkvData(null);
    autoPicked.current = false;
  }, [streamUrl]);

  /* --- MKV: poll the proxy for the track list (it's in the file header) --- */
  useEffect(() => {
    if (!inTauri || !streamUrl || hls) return;
    let alive = true;
    let n = 0;
    const tick = async () => {
      const t = await mkvTracks(streamUrl);
      if (!alive) return;
      if (t.length) {
        setMkv(t.sort((a, b) => a.number - b.number));
        return;
      }
      if (++n < 30) timer = window.setTimeout(tick, 1000);
    };
    let timer = window.setTimeout(tick, 600);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [streamUrl, hls]);

  /* --- MKV: auto-select preferred language, else the track flagged default --- */
  useEffect(() => {
    if (!mkv.length || autoPicked.current || sel) return;
    autoPicked.current = true;
    const text = mkv.filter((t) => t.text);
    const pick = (prefLang && text.find((t) => langMatches(t.lang, prefLang) && !t.forced)) || text.find((t) => t.default && !t.forced) || null;
    if (pick) setSel(`mkv:${pick.number}`);
  }, [mkv, prefLang, sel]);

  /* --- MKV: keep pulling cues for the selected track as playback buffers more --- */
  const mkvSel = sel?.startsWith("mkv:") ? Number(sel.slice(4)) : null;
  useEffect(() => {
    setMkvData(null);
    if (mkvSel == null || !streamUrl) return;
    let alive = true;
    let ver: number | null = null;
    const tick = async () => {
      const r = await mkvCues(streamUrl, mkvSel, ver);
      if (!alive || !r) return; // null = nothing new since last time
      ver = r.ver;
      setMkvData({ track: mkvSel, cues: r.cues });
    };
    tick();
    const iv = window.setInterval(tick, 500);
    // after a seek the first lines would otherwise wait for the next poll
    const events = ["seeking", "seeked", "waiting", "playing"] as const;
    for (const e of events) video?.addEventListener(e, tick);
    return () => {
      alive = false;
      window.clearInterval(iv);
      for (const e of events) video?.removeEventListener(e, tick);
    };
  }, [mkvSel, streamUrl, video]);

  useCueTrack(video, FILE_LABEL, ext ? `file:${ext.name}` : null, ext?.cues ?? [], offset - txOff, sel === "file");
  const mkvCurrent = mkvData && mkvData.track === mkvSel ? mkvData.cues : NO_CUES;
  useCueTrack(video, MKV_LABEL, mkvSel != null ? `mkv:${mkvSel}` : null, mkvCurrent, offset - txOff, mkvSel != null);

  /* --- a freshly loaded file becomes the active subtitle --- */
  useEffect(() => {
    if (!ext) {
      setSel((s) => (s === "file" ? null : s));
      return;
    }
    setSel("file");
  }, [ext]);

  /* --- when one of our sources is active, silence hls / native tracks --- */
  useEffect(() => {
    if (!video || !sel) return;
    if (hls) hls.subtitleTrack = -1;
    for (const n of nativeTracks(video)) n.mode = "disabled";
    bump();
  }, [sel, video, hls]);

  /* --- listen for track list changes --- */
  useEffect(() => {
    if (!video) return;
    const tt = video.textTracks;
    const onAdd = (e: TrackEvent) => {
      const t = e.track as TextTrack | null;
      if (!t || OURS.has(t.label)) return;
      // never show embedded CC on top of a selected subtitle
      if (hls && t.kind === "captions" && (hls.subtitleTrack >= 0 || sel)) t.mode = "disabled";
      else if (!hls && prefLang && !sel && langMatches(t.language, prefLang) && !nativeTracks(video).some((x) => x.mode === "showing")) t.mode = "showing";
      bump();
    };
    tt.addEventListener("addtrack", onAdd);
    tt.addEventListener("removetrack", bump);
    tt.addEventListener("change", bump);
    const at = audioTracksOf(video);
    at?.addEventListener("addtrack", bump);
    at?.addEventListener("change", bump);
    return () => {
      tt.removeEventListener("addtrack", onAdd);
      tt.removeEventListener("removetrack", bump);
      tt.removeEventListener("change", bump);
      at?.removeEventListener("addtrack", bump);
      at?.removeEventListener("change", bump);
    };
  }, [video, hls, prefLang, sel]);

  useEffect(() => {
    if (!hls) return;
    const evs = [Hls.Events.MANIFEST_PARSED, Hls.Events.SUBTITLE_TRACKS_UPDATED, Hls.Events.SUBTITLE_TRACK_SWITCH, Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED] as const;
    const autoPick = () => {
      if (!prefLang || hls.subtitleTrack !== -1) return;
      const i = hls.subtitleTracks.findIndex((t) => langMatches(t.lang, prefLang));
      if (i >= 0) {
        hls.subtitleDisplay = true;
        hls.subtitleTrack = i;
      }
    };
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, autoPick);
    for (const e of evs) hls.on(e, bump);
    return () => {
      hls.off(Hls.Events.SUBTITLE_TRACKS_UPDATED, autoPick);
      for (const e of evs) hls.off(e, bump);
    };
  }, [hls, prefLang]);

  return useMemo<Tracks>(() => {
    const subs: Track[] = [];
    const audio: Track[] = [];
    if (hls) {
      hls.subtitleTracks.forEach((t, i) => subs.push({ id: `hls:${i}`, label: niceLabel(t.name, t.lang, i), lang: t.lang, active: !sel && hls.subtitleDisplay && hls.subtitleTrack === i }));
      if (video) ccTracks(video).forEach((t, i) => subs.push({ id: `cc:${i}`, label: `CC · ${niceLabel(t.label, t.language, i)}`, lang: t.language, active: !sel && t.mode === "showing" }));
      hls.audioTracks.forEach((t, i) => audio.push({ id: `hlsa:${i}`, label: niceLabel(t.name, t.lang, i), lang: t.lang, active: hls.audioTrack === i }));
    } else if (video) {
      nativeTracks(video).forEach((t, i) => subs.push({ id: `nat:${i}`, label: niceLabel(t.label, t.language, i), lang: t.language, active: !sel && t.mode === "showing" }));
      const at = audioTracksOf(video);
      if (at && at.length > 1) for (let i = 0; i < at.length; i++) audio.push({ id: `nata:${i}`, label: niceLabel(at[i].label, at[i].language, i), lang: at[i].language, active: at[i].enabled });
    }
    mkv.forEach((t, i) => {
      const flags = [t.forced && tr("forçadas"), t.default && tr("padrão")].filter(Boolean).join(", ");
      subs.push({
        id: `mkv:${t.number}`,
        label: niceLabel(t.name, t.lang, i),
        lang: t.lang,
        active: sel === `mkv:${t.number}`,
        disabled: !t.text,
        hint: !t.text ? tr("imagem (PGS/VobSub) - usa o VLC") : flags || undefined,
      });
    });
    if (ext) subs.push({ id: "file", label: ext.name, active: sel === "file", hint: tr("ficheiro") });

    return {
      subs,
      audio,
      selectSub(id) {
        if (!video) return;
        const ours = id === "file" || !!id?.startsWith("mkv:");
        setSel(ours ? id : null);
        if (hls) {
          if (id?.startsWith("hls:")) {
            hls.subtitleDisplay = true;
            hls.subtitleTrack = Number(id.slice(4));
          } else hls.subtitleTrack = -1;
          ccTracks(video).forEach((t, i) => (t.mode = id === `cc:${i}` ? "showing" : "disabled"));
        } else {
          nativeTracks(video).forEach((t, i) => (t.mode = id === `nat:${i}` ? "showing" : "disabled"));
        }
        bump();
      },
      selectAudio(id) {
        if (hls && id.startsWith("hlsa:")) hls.audioTrack = Number(id.slice(5));
        if (video && id.startsWith("nata:")) {
          const at = audioTracksOf(video);
          const idx = Number(id.slice(5));
          if (at) for (let i = 0; i < at.length; i++) at[i].enabled = i === idx;
        }
        bump();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hls, video, ext, mkv, sel, ver]);
}

export function TrackMenu({
  tracks,
  ext,
  offset,
  onOffset,
  onLoadFile,
  onClearFile,
  onClose,
}: {
  tracks: Tracks;
  ext: { name: string } | null;
  offset: number;
  onOffset: (n: number) => void;
  onLoadFile: () => void;
  onClearFile: () => void;
  onClose: () => void;
}) {
  const anySub = tracks.subs.some((s) => s.active);
  const syncable = tracks.subs.some((s) => (s.id === "file" || s.id.startsWith("mkv:")) && s.active);
  const step = (d: number) => onOffset(Math.round((offset + d) * 10) / 10);

  return (
    <div data-focus-scope className="glass absolute right-0 bottom-full z-30 mb-3 w-[600px] overflow-hidden rounded-2xl shadow-2xl shadow-black/60 animate-fade-up" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-[1.25fr_1fr] divide-x divide-white/10">
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-bold tracking-widest text-sky-100/55 uppercase">
            <Captions className="size-4" /> {tr("Legendas")}
            {tracks.subs.length > 0 && <span className="ml-auto rounded-md bg-white/10 px-1.5 text-[10px] tabular-nums">{tracks.subs.length}</span>}
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            <Opt active={!anySub} onClick={() => tracks.selectSub(null)} autoFocus={!anySub}>
              {tr("Desligadas")}
            </Opt>
            {tracks.subs.map((t) => (
              <Opt key={t.id} active={t.active} disabled={t.disabled} hint={t.hint} onClick={() => tracks.selectSub(t.id)} autoFocus={t.active}>
                {t.disabled && <ImageIcon className="mr-1.5 inline size-3.5" />}
                {t.label}
              </Opt>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5 border-t border-white/10 pt-2">
            <button onClick={onLoadFile} className="focusable flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/8 px-3 py-2 text-xs font-bold hover:bg-white/15">
              <FileUp className="size-4" /> {tr("Carregar ficheiro…")}
            </button>
            {ext && (
              <button onClick={onClearFile} title={tr("Remover ficheiro")} className="focusable grid size-9 place-items-center rounded-lg bg-white/8 hover:bg-rose-500/30">
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
          {!tracks.subs.length && (
            <p className="mt-2 px-2 text-[11px] leading-relaxed text-sky-100/40">
              {tr("Ainda sem legendas neste stream. Em ficheiros MKV aparecem assim que o início do vídeo carrega. Também podes carregar um .srt / .vtt / .ass ou arrastá-lo para o vídeo.")}
            </p>
          )}
        </div>
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-[11px] font-bold tracking-widest text-sky-100/55 uppercase">
            <AudioLines className="size-4" /> {tr("Áudio")}
          </div>
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {tracks.audio.length ? (
              tracks.audio.map((t) => (
                <Opt key={t.id} active={t.active} onClick={() => tracks.selectAudio(t.id)}>
                  {t.label}
                </Opt>
              ))
            ) : (
              <div className="px-2 py-2 text-xs text-sky-100/40">{tr("Faixa única.")}</div>
            )}
          </div>
        </div>
      </div>
      {syncable && (
        <div className="flex items-center gap-2 border-t border-white/10 bg-black/20 px-4 py-2.5">
          <span className="flex-1 text-xs font-semibold text-sky-100/70">{tr("Sincronização das legendas")}</span>
          <SyncBtn onClick={() => step(-0.5)}>−0.5</SyncBtn>
          <SyncBtn onClick={() => step(-0.1)}>
            <Minus className="size-3.5" />
          </SyncBtn>
          <span className="w-16 text-center text-sm font-bold tabular-nums">
            {offset > 0 ? "+" : ""}
            {offset.toFixed(1)}s
          </span>
          <SyncBtn onClick={() => step(0.1)}>
            <Plus className="size-3.5" />
          </SyncBtn>
          <SyncBtn onClick={() => step(0.5)}>+0.5</SyncBtn>
          <SyncBtn onClick={() => onOffset(0)}>{tr("Repor")}</SyncBtn>
        </div>
      )}
      <div className="flex justify-between border-t border-white/10 px-4 py-2 text-[10px] text-sky-100/35">
        <span>{tr("C abre/fecha · G/H ajustam a sincronização")}</span>
        <button onClick={onClose} className="focusable font-bold text-sky-200/70 hover:text-white">
          {tr("Fechar")}
        </button>
      </div>
    </div>
  );
}

function Opt({ active, onClick, children, autoFocus, disabled, hint }: { active: boolean; onClick: () => void; children: React.ReactNode; autoFocus?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick}
      autoFocus={autoFocus}
      disabled={disabled}
      className={cn(
        "focusable flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-sky-500/25 font-bold text-white" : "text-sky-50/80 hover:bg-white/8",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-[10px] font-medium text-sky-100/40">{hint}</span>}
      </span>
      {active && <Check className="size-4 shrink-0 text-sky-300" />}
    </button>
  );
}

function SyncBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="focusable grid h-8 min-w-8 place-items-center rounded-lg bg-white/10 px-2 text-xs font-bold hover:bg-white/20">
      {children}
    </button>
  );
}
