import { CalendarClock, Clapperboard, Film, Grid2x2, History, House, Radio, Search, Settings, Star, Tv, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/util";
import { useApp, useProfile, useScreen, type Screen } from "../store/app";

import { t } from "../lib/i18n";
const MAIN: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: "home", get label() { return t("Início"); }, icon: <House /> },
  { id: "search", get label() { return t("Pesquisar"); }, icon: <Search /> },
  { id: "live", get label() { return t("TV em Direto"); }, icon: <Tv /> },
  { id: "epg", get label() { return t("Guia TV"); }, icon: <CalendarClock /> },
  { id: "vod", get label() { return t("Filmes"); }, icon: <Film /> },
  { id: "series", get label() { return t("Séries"); }, icon: <Clapperboard /> },
];
const MORE: { id: Screen; label: string; icon: ReactNode }[] = [
  { id: "catchup", get label() { return t("Catch Up"); }, icon: <History /> },
  { id: "multi", get label() { return t("Multi-ecrã"); }, icon: <Grid2x2 /> },
  { id: "radio", get label() { return t("Rádio"); }, icon: <Radio /> },
  { id: "favorites", get label() { return t("Favoritos"); }, icon: <Star /> },
];

/**
 * Slim icon rail that expands into a labelled drawer on hover / keyboard focus.
 */
export function Sidebar({ onProfiles }: { onProfiles: () => void }) {
  const screen = useScreen();
  const nav = useApp((s) => s.nav);
  const profile = useProfile();

  return (
    <nav className="group/side relative z-20 h-full w-[76px] shrink-0">
      <div className="absolute inset-y-0 left-0 flex w-[76px] flex-col overflow-hidden border-r border-white/[0.06] bg-ink-950/80 py-4 backdrop-blur-2xl transition-[width,box-shadow] duration-300 ease-out group-hover/side:w-[232px] group-hover/side:shadow-[24px_0_60px_-20px_rgba(0,0,0,0.8)] group-focus-within/side:w-[232px] group-focus-within/side:shadow-[24px_0_60px_-20px_rgba(0,0,0,0.8)]">
        <button onClick={() => nav("home")} className="focusable mx-3 mb-6 flex items-center gap-3 rounded-2xl p-1.5">
          <img src="/brand-mark.png" alt="" className="size-11 shrink-0 object-contain drop-shadow-[0_6px_18px_rgba(34,225,255,0.35)]" draggable={false} />
          <span className="font-display text-lg font-bold whitespace-nowrap opacity-0 transition group-hover/side:opacity-100 group-focus-within/side:opacity-100">
            {t("Hurricane")}<span className="text-gradient">{t("TV")}</span>
          </span>
        </button>

        <div className="flex flex-1 flex-col gap-1 px-3">
          {MAIN.map((i) => (
            <Item key={i.id} {...i} active={screen === i.id} onClick={() => nav(i.id)} />
          ))}
          <div className="mx-3 my-3 h-px bg-white/[0.07]" />
          {MORE.map((i) => (
            <Item key={i.id} {...i} active={screen === i.id} onClick={() => nav(i.id)} />
          ))}
        </div>

        <div className="flex flex-col gap-1 px-3">
          <Item id="settings" label={t("Definições")} icon={<Settings />} active={screen === "settings"} onClick={() => nav("settings")} />
          <button
            onClick={() => (screen === "account" ? onProfiles() : nav("account"))}
            className={cn("focusable mt-1 flex items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-white/[0.06]", screen === "account" && "bg-white/[0.06]")}
          >
            <span className="bg-storm grid size-9 shrink-0 place-items-center rounded-full text-ink-950">
              <UserRound className="size-[18px]" strokeWidth={2.4} />
            </span>
            <span className="min-w-0 opacity-0 transition group-hover/side:opacity-100 group-focus-within/side:opacity-100">
              <span className="block truncate text-sm font-semibold">{profile?.name}</span>
              <span className="block text-[11px] text-sky-100/45">{t("Conta e perfis")}</span>
            </span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function Item({ label, icon, active, onClick }: { id: Screen; label: string; icon: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "focusable relative flex h-11 items-center gap-3.5 rounded-xl px-3 text-left transition",
        active ? "bg-gradient-to-r from-sky-400/[0.16] to-blue-600/[0.08] text-white" : "text-sky-100/55 hover:bg-white/[0.05] hover:text-white",
      )}
    >
      {active && <span className="bg-storm absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full shadow-[0_0_12px_#22e1ff]" />}
      <span className={cn("shrink-0 [&>svg]:size-[22px]", active ? "text-sky-300 [&>svg]:stroke-[2.2]" : "[&>svg]:stroke-[1.8]")}>{icon}</span>
      <span className="text-sm font-semibold whitespace-nowrap opacity-0 transition group-hover/side:opacity-100 group-focus-within/side:opacity-100">{label}</span>
    </button>
  );
}
