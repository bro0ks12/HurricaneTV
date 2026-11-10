import { CalendarClock, ChevronLeft, ChevronRight, LayoutList, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryList, ChannelLogo, Empty, ScreenHeader, Spinner } from "../components/ui";
import { useParental } from "../lib/parental";
import { useQuery } from "../lib/query";
import { isAdult } from "../lib/settings";
import type { Channel, Program } from "../lib/types";
import { cn, fmtDay, fmtTime, tidyPrograms } from "../lib/util";
import { useApp, useFavs, useProfile, useProvider } from "../store/app";

import { t } from "../lib/i18n";
const PX_PER_MIN = 5;
const HOURS = 8;
const ROW_H = 64;
const CH_W = 230;
const MAX_ROWS = 80;

export function Epg() {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const hideAdult = useApp((s) => s.settings.hideAdult);
  const favs = useFavs();
  const [cat, setCat] = useState("__all");
  const [offsetH, setOffsetH] = useState(0);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const cats = useQuery(`live-cats:${profile.id}`, () => provider.liveCategories());
  const par = useParental("live", cats.data);
  const all = useQuery(`live-all:${profile.id}`, () => provider.liveChannels());

  const categories = useMemo(() => (hideAdult ? (cats.data ?? []).filter((c) => !isAdult(c.name)) : (cats.data ?? [])), [cats.data, hideAdult]);
  const channels = useMemo(() => {
    let l = cat === "__fav" ? favs.live : (all.data ?? []);
    if (cat !== "__all" && cat !== "__fav") l = l.filter((c) => c.categoryId === cat);
    return l.filter((c) => !c.isRadio && !par.hidden.has(c.categoryId ?? "")).slice(0, MAX_ROWS);
  }, [cat, all.data, favs.live, par.hidden]);

  const start = useMemo(() => {
    const d = new Date(now);
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
    return d.getTime() - 30 * 60000 + offsetH * 3600e3;
  }, [now, offsetH]);
  const end = start + HOURS * 3600e3;
  const width = HOURS * 60 * PX_PER_MIN;
  const nowX = ((now - start) / 60000) * PX_PER_MIN;

  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
  }, [offsetH, cat]);

  const slots = Array.from({ length: HOURS * 2 }, (_, i) => start + i * 30 * 60000);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("Guia TV")} icon={<CalendarClock className="size-5" />}>
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          <button onClick={() => setOffsetH((o) => o - 3)} className="focusable grid size-8 place-items-center rounded-lg hover:bg-white/10">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setOffsetH(0)} className={cn("focusable rounded-lg px-3 py-1.5 text-xs font-bold", offsetH === 0 ? "bg-white/15" : "text-sky-100/60 hover:text-white")}>
            {t("Agora")}
          </button>
          <button onClick={() => setOffsetH((o) => o + 3)} className="focusable grid size-8 place-items-center rounded-lg hover:bg-white/10">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <span className="text-sm font-semibold text-sky-100/60 capitalize">{fmtDay(start)}</span>
      </ScreenHeader>
      <div className="flex min-h-0 flex-1">
        <CategoryList
          parental={par}
          loading={cats.loading}
          categories={categories}
          active={cat}
          onSelect={setCat}
          extra={[
            { id: "__all", name: t("Todos os canais"), icon: <LayoutList className="size-4" /> },
            { id: "__fav", name: t("Favoritos"), icon: <Star className="size-4" /> },
          ]}
        />
        <div className="min-w-0 flex-1 bg-ink-950/25">
          {all.loading ? (
            <Spinner label={t("A carregar guia…")} />
          ) : !channels.length ? (
            <Empty icon={<CalendarClock className="size-6" />} title={t("Sem canais")} />
          ) : (
            <div ref={scroller} className="relative h-full overflow-auto">
              <div style={{ width: width + CH_W }} className="relative">
                {/* time header */}
                <div className="sticky top-0 z-20 flex h-11 border-b border-white/10 bg-ink-900/95 backdrop-blur">
                  <div style={{ width: CH_W }} className="sticky left-0 z-10 shrink-0 border-r border-white/10 bg-ink-900/95" />
                  {slots.map((t) => (
                    <div key={t} style={{ width: 30 * PX_PER_MIN }} className="shrink-0 border-l border-white/5 px-2 pt-3 text-xs font-bold text-sky-100/60 tabular-nums">
                      {fmtTime(t)}
                    </div>
                  ))}
                </div>
                {/* now line */}
                {nowX > 0 && nowX < width && (
                  <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-rose-500 shadow-[0_0_12px] shadow-rose-500" style={{ left: CH_W + nowX }}>
                    <div className="absolute -top-0 -left-[5px] size-3 rounded-full bg-rose-500" />
                  </div>
                )}
                {channels.map((ch) => (
                  <EpgRow key={ch.id} ch={ch} channels={channels} start={start} end={end} now={now} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EpgRow({ ch, channels, start, end, now }: { ch: Channel; channels: Channel[]; start: number; end: number; now: number }) {
  const provider = useProvider()!;
  const play = useApp((s) => s.play);
  const h24 = useApp((s) => s.settings.timeFormat24);
  const epg = useQuery(`epg-grid:${ch.id}`, () => provider.epg(ch, 30));

  const progs = tidyPrograms(epg.data ?? []).filter((p) => p.end > start && p.start < end);
  const openLive = () => play({ title: ch.name, stream: ch.stream, type: "live", channels, index: channels.indexOf(ch), poster: ch.logo, ua: ch.ua, referer: ch.referer });
  const openProgram = async (p: Program) => {
    if (p.start <= now && p.end > now) return openLive();
    if (p.end < now && ch.catchup && provider.catchupUrl) {
      const url = await provider.catchupUrl(ch, p);
      play({ title: ch.name, subtitle: `${p.title} · ${fmtTime(p.start, h24)}`, stream: url, type: "url", poster: ch.logo, ua: ch.ua, referer: ch.referer });
    }
  };

  return (
    <div className="flex border-b border-white/[0.06]" style={{ height: ROW_H }}>
      <button onClick={openLive} style={{ width: CH_W }} className="focusable sticky left-0 z-10 flex shrink-0 items-center gap-2.5 border-r border-white/10 bg-ink-900/95 px-3 text-left backdrop-blur hover:bg-ink-800">
        <span className="w-7 text-right text-xs font-bold text-sky-100/40 tabular-nums">{ch.num}</span>
        <ChannelLogo src={ch.logo} name={ch.name} className="size-9" />
        <span className="truncate text-[13px] font-semibold">{ch.name}</span>
      </button>
      <div className="relative flex-1">
        {epg.loading && <div className="skeleton absolute inset-y-2 left-2 w-1/2 rounded-lg" />}
        {!epg.loading && !progs.length && <div className="absolute inset-y-2 left-1 right-1 flex items-center rounded-lg bg-white/[0.03] px-3 text-xs text-sky-100/30">{t("Sem informação")}</div>}
        {progs.map((p, i) => {
          const s = Math.max(p.start, start);
          const e = Math.min(p.end, end);
          const left = ((s - start) / 60000) * PX_PER_MIN;
          const w = ((e - s) / 60000) * PX_PER_MIN;
          const live = p.start <= now && p.end > now;
          const past = p.end <= now;
          return (
            <button
              key={i}
              onClick={() => openProgram(p)}
              title={p.description || p.title}
              style={{ left: left + 1, width: Math.max(w - 3, 4) }}
              className={cn(
                "focusable absolute inset-y-1.5 overflow-hidden rounded-lg px-2.5 text-left transition",
                live ? "bg-gradient-to-r from-sky-500/45 to-blue-600/35 ring-1 ring-sky-300/50 hover:from-sky-500/60" : past ? "bg-white/[0.03] text-white/45 hover:bg-white/[0.08]" : "bg-white/[0.07] hover:bg-white/[0.13]",
              )}
            >
              <div className="truncate pt-1.5 text-[13px] font-semibold">{p.title}</div>
              <div className="truncate text-[11px] text-sky-100/55 tabular-nums">
                {fmtTime(p.start, h24)} – {fmtTime(p.end, h24)}
                {past && ch.catchup ? t(" · ⟲ Catch-up") : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
