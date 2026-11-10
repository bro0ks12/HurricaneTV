import Hls from "hls.js";
import mpegts from "mpegts.js";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { probeStream, proxied, txUrl, type StreamHeaders } from "../lib/http";
import { cn } from "../lib/util";

import { t } from "../lib/i18n";
export type Engine = "hls" | "mpegts" | "native";

/** Best guess from the url alone; null when the url gives no hint. */
function guessEngine(url: string): Engine | null {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8") || path.endsWith(".m3u") || /[?&](type|format|output)=(m3u8|hls)/i.test(url)) return "hls";
  if (/\.(mp4|mkv|webm|mov|m4v|avi)$/.test(path)) return "native";
  if (path.endsWith(".ts") || /[?&](type|format|output)=(ts|mpegts)/i.test(url)) return "mpegts";
  return null;
}

async function engineOrder(url: string, live: boolean, headers?: StreamHeaders): Promise<Engine[]> {
  let first = guessEngine(url);
  if (!first) {
    // Extension-less IPTV url: sniff the first bytes (redirects to HLS are common)
    const p = await probeStream(url, headers);
    if (p?.kind === "hls") first = "hls";
    else if (p?.kind === "ts") first = "mpegts";
    else if (p?.kind === "mp4" || p?.kind === "mkv") first = "native";
    else first = live ? "mpegts" : "native";
  }
  const all: Engine[] = live ? ["hls", "mpegts", "native"] : ["native", "hls", "mpegts"];
  return [first, ...all.filter((e) => e !== first)];
}

export type ErrorKind = "codec" | "http" | "network" | "timeout" | "other";

export interface VideoStatus {
  state: "loading" | "playing" | "paused" | "error";
  error?: string;
  kind?: ErrorKind;
  engine?: Engine;
}

interface Props {
  url: string | null;
  live: boolean;
  muted?: boolean;
  /** 0..1 */
  volume?: number;
  headers?: StreamHeaders;
  className?: string;
  startAt?: number;
  /**
   * Play a converted copy (ffmpeg → fragmented MP4) because the webview can't decode this file's audio / video.
   * `currentTime` and `duration` keep describing the ORIGINAL title, so seeking, resume and subtitles still line up.
   */
  tx?: { mode: "audio" | "video"; audio: number; duration: number; start: number } | null;
  onStatus?: (s: VideoStatus) => void;
  onTime?: (t: number, d: number) => void;
  /** current hls.js instance (for subtitle / audio tracks), null otherwise */
  onHls?: (hls: Hls | null) => void;
}

const LOAD_TIMEOUT = 25_000;

const describe = (kind: ErrorKind, detail?: string) => {
  switch (kind) {
    case "codec":
      return t("Codec não suportado por este leitor (ex.: HEVC, AC-3 ou áudio MP2). Experimenta abrir num leitor externo.");
    case "http":
      return t("O servidor recusou o stream{0}. Pode estar offline ou com o limite de ligações atingido.", { 0: detail ? ` (${detail})` : "" });
    case "timeout":
      return t("O servidor não respondeu a tempo.");
    case "network":
      return t("Erro de rede ao carregar o stream.");
    default:
      return detail || t("Não foi possível reproduzir este stream.");
  }
};

export const VideoSurface = forwardRef<HTMLVideoElement | null, Props>(function VideoSurface(
  { url, live, muted, volume, headers, className, startAt, tx, onStatus, onTime, onHls },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => video.current!, []);
  const cb = useRef({ onStatus, onTime, onHls });
  cb.current = { onStatus, onTime, onHls };
  // only read when a stream starts; changing it must never reload the video
  const startRef = useRef(startAt);
  startRef.current = startAt;
  const txRef = useRef(tx);
  txRef.current = tx;
  const txKey = tx ? `${tx.mode}:${tx.audio}` : "";
  const ua = headers?.ua;
  const referer = headers?.referer;

  useEffect(() => {
    const v = video.current;
    if (!v || !url) return;
    const hd: StreamHeaders = { ua, referer };
    const status = (s: VideoStatus) => cb.current.onStatus?.(s);
    let disposed = false;
    let cleanup: (() => void) | null = null;
    let order: Engine[] = [];
    let attempt = 0;

    const startEngine = (engine: Engine) => {
      status({ state: "loading", engine });
      const src = proxied(url, hd, live);
      let hls: Hls | null = null;
      let ts: mpegts.Player | null = null;
      let played = false;
      let failed = false;

      const fail = (kind: ErrorKind, detail?: string) => {
        if (disposed || failed) return;
        failed = true;
        // A 4xx/5xx won't get better with another engine; codec errors might.
        if (kind !== "http" && attempt < order.length - 1) {
          attempt++;
          cleanup?.();
          cleanup = startEngine(order[attempt]);
          return;
        }
        status({ state: "error", kind, error: describe(kind, detail), engine });
      };

      const timer = window.setTimeout(() => !played && fail("timeout"), LOAD_TIMEOUT);

      if (engine === "hls" && Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // live: keep ~5 min behind the playhead (timeshift) and keep fetching
          // while paused; the playlist edge naturally limits how far ahead we go
          backBufferLength: live ? 300 : 90,
          maxBufferLength: live ? 300 : 60,
          maxMaxBufferLength: live ? 300 : 120,
          maxBufferSize: live ? 200 * 1000 * 1000 : 60 * 1000 * 1000,
          // stay a few segments behind the live edge so short hiccups don't stall
          liveSyncDurationCount: 4,
          maxBufferHole: 1,
          nudgeMaxRetry: 6,
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
          renderTextTracksNatively: true,
        });
        hls.loadSource(src);
        hls.attachMedia(v);
        cb.current.onHls?.(hls);
        let mediaRecoveries = 0;
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal) return;
          const codec = /codec|incompatible|bufferAddCodecError|bufferAppendError/i.test(String(d.details));
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !codec && mediaRecoveries++ < 2) {
            hls?.recoverMediaError();
            return;
          }
          if (codec) return fail("codec");
          const code = d.response?.code;
          if (code && code >= 400) return fail("http", t("HTTP {0}", { 0: code }));
          if (String(d.details).includes("manifestParsingError")) return fail("other", t("Resposta não é uma playlist HLS"));
          fail(d.type === Hls.ErrorTypes.NETWORK_ERROR ? "network" : "other", String(d.details));
        });
      } else if (engine === "mpegts" && mpegts.getFeatureList().mseLivePlayback) {
        ts = mpegts.createPlayer(
          { type: "mpegts", isLive: live, url: src },
          {
            enableWorker: true,
            // Never jump forward to "catch up" with the live edge: on jittery IPTV
            // links that shows up as stutter + skips. Keep a real buffer instead.
            liveBufferLatencyChasing: false,
            liveSync: false,
            enableStashBuffer: true,
            stashInitialSize: live ? 1024 * 1024 : 384 * 1024,
            lazyLoad: !live,
            autoCleanupSourceBuffer: true,
            // live timeshift window (bounded by the webview's MSE memory quota)
            autoCleanupMaxBackwardDuration: live ? 300 : 90,
            autoCleanupMinBackwardDuration: live ? 240 : 45,
            fixAudioTimestampGap: true,
          },
        );
        ts.attachMediaElement(v);
        ts.load();
        ts.on(mpegts.Events.ERROR, (type: string, detail: string, info: { code?: number; msg?: string }) => {
          if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
            if (info?.code && info.code >= 400) return fail("http", t("HTTP {0}", { 0: info.code }));
            return fail("network", detail);
          }
          if (/codec|unsupported|MediaMSEError|FormatUnsupported/i.test(`${detail} ${info?.msg ?? ""}`)) return fail("codec");
          fail("other", `${detail}${info?.msg ? `: ${info.msg}` : ""}`);
        });
      } else {
        v.src = src;
      }

      const startAt = startRef.current;
      const seek = () => {
        if (startAt && v.duration && startAt < v.duration - 10) v.currentTime = startAt;
      };
      const onMeta = () => seek();
      const onCanPlay = () => v.play().catch(() => {});
      const onPlaying = () => {
        played = true;
        status({ state: "playing", engine });
      };
      const onPause = () => status({ state: "paused", engine });
      const onWaiting = () => status({ state: "loading", engine });
      const onErr = () => {
        if (hls || ts) return; // engines report their own errors
        const code = v.error?.code;
        fail(code === 4 || code === 3 ? "codec" : code === 2 ? "network" : "other", v.error?.message);
      };
      const onTimeUpd = () => cb.current.onTime?.(v.currentTime, v.duration);
      if (startAt) v.addEventListener("loadedmetadata", onMeta, { once: true });
      v.addEventListener("canplay", onCanPlay);
      v.addEventListener("playing", onPlaying);
      v.addEventListener("pause", onPause);
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("error", onErr);
      v.addEventListener("timeupdate", onTimeUpd);

      return () => {
        window.clearTimeout(timer);
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeEventListener("canplay", onCanPlay);
        v.removeEventListener("playing", onPlaying);
        v.removeEventListener("pause", onPause);
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("error", onErr);
        v.removeEventListener("timeupdate", onTimeUpd);
        if (hls) {
          hls.destroy();
          cb.current.onHls?.(null);
        }
        if (ts) {
          try {
            ts.pause();
            ts.unload();
            ts.detachMediaElement();
            ts.destroy();
          } catch {
            /* ignore */
          }
        }
        v.removeAttribute("src");
        v.load();
      };
    };

    // Converted playback: one <video src> on a fragmented-MP4 stream, with a virtual timeline over the whole title.
    const startTx = (plan: NonNullable<Props["tx"]>) => {
      status({ state: "loading", engine: "native" });
      const nativeTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
      let offset = 0; // title time at which the current converted stream starts
      let played = false;
      // text tracks (embedded subtitles) are timed against the element's NATIVE clock, so tell them where this stream starts
      const publishOffset = () => {
        (v as HTMLVideoElement & { txOffset?: number }).txOffset = offset;
        v.dispatchEvent(new Event("txoffset"));
      };
      const load = (at: number) => {
        offset = Math.max(0, Math.min(at, Math.max(0, plan.duration - 1)));
        publishOffset();
        v.src = txUrl(url, hd, { ss: offset, mode: plan.mode, audio: plan.audio });
        v.play().catch(() => {});
      };
      Object.defineProperty(v, "currentTime", {
        configurable: true,
        get: () => (nativeTime.get as () => number).call(v) + offset,
        set: (time: number) => {
          const rel = time - offset;
          const b = v.buffered;
          const end = b.length ? b.end(b.length - 1) : 0;
          // inside what is already buffered: a plain seek; otherwise restart the conversion there
          if (rel >= 0 && rel <= end - 0.5) (nativeTime.set as (n: number) => void).call(v, rel);
          else {
            status({ state: "loading", engine: "native" });
            load(time);
          }
        },
      });
      Object.defineProperty(v, "duration", { configurable: true, get: () => plan.duration });

      const timer = window.setTimeout(() => !played && status({ state: "error", kind: "timeout", error: describe("timeout"), engine: "native" }), LOAD_TIMEOUT * 2);
      const onCanPlay = () => v.play().catch(() => {});
      const onPlaying = () => {
        played = true;
        status({ state: "playing", engine: "native" });
      };
      const onPause = () => status({ state: "paused", engine: "native" });
      const onWaiting = () => status({ state: "loading", engine: "native" });
      const onErr = () => {
        // a stream we replaced on purpose reports no error; a real one means ffmpeg failed
        if (v.error) status({ state: "error", kind: "other", error: t("Não foi possível converter este ficheiro."), engine: "native" });
      };
      const onTimeUpd = () => cb.current.onTime?.(v.currentTime, plan.duration);
      v.addEventListener("canplay", onCanPlay);
      v.addEventListener("playing", onPlaying);
      v.addEventListener("pause", onPause);
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("error", onErr);
      v.addEventListener("timeupdate", onTimeUpd);
      load(plan.start);

      return () => {
        window.clearTimeout(timer);
        v.removeEventListener("canplay", onCanPlay);
        v.removeEventListener("playing", onPlaying);
        v.removeEventListener("pause", onPause);
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("error", onErr);
        v.removeEventListener("timeupdate", onTimeUpd);
        offset = 0;
        publishOffset();
        delete (v as { currentTime?: number }).currentTime;
        delete (v as { duration?: number }).duration;
        v.removeAttribute("src");
        v.load();
      };
    };

    if (txRef.current && !live) {
      cleanup = startTx(txRef.current);
      return () => {
        disposed = true;
        cleanup?.();
      };
    }

    status({ state: "loading" });
    engineOrder(url, live, hd).then((o) => {
      if (disposed) return;
      order = o;
      cleanup = startEngine(order[0]);
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [url, live, ua, referer, txKey]);

  useEffect(() => {
    if (video.current) video.current.muted = !!muted;
  }, [muted]);

  useEffect(() => {
    if (video.current && volume != null) video.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume, url]);

  return <video ref={video} className={cn("size-full bg-black object-contain", className)} playsInline autoPlay muted={muted} />;
});
