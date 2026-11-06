import {
  CalendarClock,
  Clapperboard,
  Expand,
  Film,
  Grid2x2,
  History,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Star,
  Tv,
  UserRound,
  Users,
} from "lucide-react";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { Clock, Logo } from "../components/ui";
import { clearCache, useQuery } from "../lib/query";
import { cn } from "../lib/util";
import { resetProviders, useApp, useProfile, useProvider, type Screen } from "../store/app";

export function Home({ onSwitchProfile }: { onSwitchProfile: () => void }) {
  const go = useApp((s) => s.go);
  const profile = useProfile();
  const provider = useProvider();
  const acc = useQuery(profile ? `acc:${profile.id}` : null, () => provider!.account());
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, []);

  const reload = () => {
    clearCache();
    resetProviders();
    acc.refetch();
  };

  const days = acc.data?.expires ? Math.ceil((acc.data.expires - Date.now()) / 864e5) : null;

  return (
    <div className="relative flex h-full flex-col px-[3.2vw] pt-[2.4vh] pb-[3vh]">
      {/* top bar */}
      <div className="grid grid-cols-3 items-start">
        <div className="animate-fade-up">
          <Clock align="left" />
        </div>
        <div className="flex flex-col items-center gap-2 animate-fade-up">
          <Logo size={72} />
          <div className="text-[13px] font-extrabold tracking-[0.35em] text-white/90">NEXO<span className="text-sky-300">TV</span></div>
        </div>
        <div className="flex justify-end gap-2.5 animate-fade-up">
          <MiniTile icon={<Search />} label="Pesquisar" onClick={() => go("search")} />
          <MiniTile icon={<RefreshCw />} label="Recarregar" onClick={reload} />
          <MiniTile icon={<Users />} label="Perfis" onClick={onSwitchProfile} />
          <MiniTile
            icon={<Expand />}
            label="Ecrã"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
          />
        </div>
      </div>

      {/* main tiles */}
      <div className="flex flex-1 items-center justify-center">
        <div className="grid w-full max-w-[1500px] grid-cols-4 gap-[1.6vw]">
          <BigTile ref={first} delay={0} icon={<Tv strokeWidth={1.3} />} label="TV em Direto" onClick={() => go("live")} />
          <BigTile delay={60} icon={<CalendarClock strokeWidth={1.3} />} label="Guia TV" onClick={() => go("epg")} />
          <BigTile delay={120} icon={<Film strokeWidth={1.3} />} label="Filmes" onClick={() => go("vod")} />
          <BigTile delay={180} icon={<Clapperboard strokeWidth={1.3} />} label="Séries" onClick={() => go("series")} />
        </div>
      </div>

      {/* bottom bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end">
        <div className="flex gap-2.5">
          <SmallTile icon={<UserRound />} label="Conta" screen="account" />
          <SmallTile icon={<Grid2x2 />} label="Multi-ecrã" screen="multi" />
          <SmallTile icon={<History />} label="Catch Up" screen="catchup" />
        </div>
        <div className="flex flex-col items-center gap-1 pb-1 text-center">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-sky-100/60 uppercase">
            <span className={cn("size-1.5 rounded-full", acc.error ? "bg-rose-400" : acc.loading ? "bg-amber-300" : "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400")} />
            {profile?.name}
          </div>
          <div className="text-xs text-sky-100/45">
            {acc.error
              ? `Erro de ligação: ${acc.error}`
              : acc.loading
                ? "A ligar ao servidor…"
                : days != null
                  ? `Subscrição expira em ${days} dia${days === 1 ? "" : "s"}`
                  : "Subscrição ilimitada"}
          </div>
        </div>
        <div className="flex justify-end gap-2.5">
          <SmallTile icon={<Star />} label="Favoritos" screen="favorites" />
          <SmallTile icon={<Radio />} label="Rádio" screen="radio" />
          <SmallTile icon={<Settings />} label="Definições" screen="settings" />
        </div>
      </div>
    </div>
  );
}

const tileBase =
  "focusable group relative flex flex-col items-center justify-center overflow-hidden border-[2.5px] border-white/85 bg-gradient-to-b from-white/[0.10] to-white/[0.02] backdrop-blur-[2px] transition duration-200 ease-out hover:scale-[1.04] hover:border-white hover:bg-white/[0.16] focus-visible:scale-[1.06] focus-visible:border-white focus-visible:bg-white/[0.18]";

function BigTileInner({ icon, label, onClick, delay }: { icon: ReactNode; label: string; onClick: () => void; delay: number }, ref: React.Ref<HTMLButtonElement>) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className={cn(tileBase, "animate-fade-up aspect-[1.05] rounded-[6px] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] focus-visible:shadow-[0_0_0_4px_rgba(56,189,248,0.35),0_30px_80px_-10px_rgba(56,189,248,0.55)]")}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/12 to-transparent" />
      <span className="pointer-events-none absolute -inset-x-10 -top-1/2 h-full rotate-12 bg-gradient-to-b from-white/0 via-white/10 to-white/0 opacity-0 transition duration-500 group-hover:translate-y-1/2 group-hover:opacity-100 group-focus-visible:translate-y-1/2 group-focus-visible:opacity-100" />
      <span className="mb-[1.6vh] text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.35)] [&>svg]:size-[clamp(64px,8.5vw,150px)]">{icon}</span>
      <span className="text-[clamp(18px,2.1vw,38px)] font-extrabold tracking-wide uppercase text-shadow">{label}</span>
    </button>
  );
}

const BigTile = forwardRef(BigTileInner);

function SmallTile({ icon, label, screen }: { icon: ReactNode; label: string; screen: Screen }) {
  const go = useApp((s) => s.go);
  return (
    <button
      onClick={() => go(screen)}
      className={cn(tileBase, "size-[clamp(64px,5.6vw,92px)] gap-1 rounded-[5px] border-2")}
    >
      <span className="[&>svg]:size-[clamp(22px,2vw,32px)] [&>svg]:stroke-[1.6]">{icon}</span>
      <span className="text-[clamp(9px,0.72vw,12px)] font-extrabold tracking-wide uppercase">{label}</span>
    </button>
  );
}

function MiniTile({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} className={cn(tileBase, "size-[clamp(44px,3.6vw,58px)] gap-0.5 rounded-[5px] border-2")}>
      <span className="[&>svg]:size-[clamp(16px,1.4vw,22px)] [&>svg]:stroke-[1.8]">{icon}</span>
      <span className="text-[8px] font-extrabold tracking-wide uppercase">{label}</span>
    </button>
  );
}
