import Hls from "hls.js";
import mpegts from "mpegts.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { proxied } from "../lib/http";
import { cn } from "../lib/util";

export type Engine = "hls" | "mpegts" | "native";

export function pickEngine(url: string, live: boolean): Engine {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".m3u8") || path.includes("/hls/") || url.includes("m3u8")) return "hls";
  if (/\.(mp4|mkv|webm|mov|m4v|avi)$/.test(path)) return "native";
  if (path.endsWith(".ts") || live) return "mpegts";
  return "native";
}

export interface VideoStatus {
  state: "loading" | "playing" | "paused" | "error";
  error?: string;
}

interface Props {
  url: string | null;
  live: boolean;
  muted?: boolean;
  ua?: string;
  className?: string;
  startAt?: number;
  onStatus?: (s: VideoStatus) => void;
  onTime?: (t: number, d: number) => void;
}

export const VideoSurface = forwardRef<HTMLVideoElement | null, Props>(function VideoSurface(
  { url, live, muted, ua, className, startAt, onStatus, onTime },
  ref,
) {
  const video = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => video.current!, []);
  const [, setTick] = useState(0);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const timeRef = useRef(onTime);
  timeRef.current = onTime;

  useEffect(() => {
    const v = video.current;
    if (!v || !url) return;
    const status = (s: VideoStatus) => statusRef.current?.(s);
    status({ state: "loading" });
    const src = proxied(url, ua);
    const engine = pickEngine(url, live);
    let hls: Hls | null = null;
    let ts: mpegts.Player | null = null;
    let disposed = false;

    const fail = (msg: string) => !disposed && status({ state: "error", error: msg });

    if (engine === "hls" && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: live,
        backBufferLength: live ? 30 : 90,
        maxBufferLength: live ? 20 : 60,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
      });
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          fail(d.response?.code ? `Erro ${d.response.code} ao carregar o stream` : "Não foi possível carregar o stream");
        }
      });
    } else if (engine === "mpegts" && mpegts.getFeatureList().mseLivePlayback) {
      ts = mpegts.createPlayer(
        { type: "mpegts", isLive: live, url: src },
        { enableWorker: true, liveBufferLatencyChasing: live, lazyLoad: !live, autoCleanupSourceBuffer: true },
      );
      ts.attachMediaElement(v);
      ts.load();
      ts.on(mpegts.Events.ERROR, (type, detail) => fail(`${type}: ${detail}`));
    } else {
      v.src = src;
    }

    if (startAt) {
      const seek = () => {
        if (v.duration && startAt < v.duration - 10) v.currentTime = startAt;
        v.removeEventListener("loadedmetadata", seek);
      };
      v.addEventListener("loadedmetadata", seek);
    }

    const tryPlay = () => v.play().catch(() => {});
    v.addEventListener("canplay", tryPlay, { once: true });
    const onPlaying = () => status({ state: "playing" });
    const onPause = () => status({ state: "paused" });
    const onWaiting = () => status({ state: "loading" });
    const onErr = () => fail(v.error?.code === 4 ? "Formato não suportado por este leitor" : "Erro de reprodução");
    const onTimeUpd = () => {
      timeRef.current?.(v.currentTime, v.duration);
      setTick((t) => t + 1);
    };
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("error", onErr);
    v.addEventListener("timeupdate", onTimeUpd);

    return () => {
      disposed = true;
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("error", onErr);
      v.removeEventListener("timeupdate", onTimeUpd);
      hls?.destroy();
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
  }, [url, live, ua, startAt]);

  useEffect(() => {
    if (video.current) video.current.muted = !!muted;
  }, [muted]);

  return <video ref={video} className={cn("size-full bg-black object-contain", className)} playsInline autoPlay muted={muted} />;
});
