import { ArrowLeft, Loader2, Lock, LockOpen, Search, Star, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../store/app";
import { cn, fmtTime } from "../lib/util";

import { t, locale } from "../lib/i18n";
/* ---------------- Background ---------------- */

export function Background({ dim = false }: { dim?: boolean }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      {/* storm glows */}
      <div className="absolute -top-[30%] -left-[15%] size-[70vw] rounded-full opacity-[0.16] blur-[120px]" style={{ background: "#22e1ff" }} />
      <div className="absolute -right-[20%] -bottom-[35%] size-[75vw] rounded-full opacity-[0.18] blur-[140px]" style={{ background: "#7c5cff" }} />
      {/* slow-turning vortex */}
      <div
        className="animate-storm absolute top-1/2 left-1/2 size-[140vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, #22e1ff 40deg, transparent 90deg, transparent 180deg, #7c5cff 220deg, transparent 270deg)", maskImage: "radial-gradient(circle, black 0%, transparent 60%)", WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 60%)" }}
      />
      {/* fine grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at 50% 30%, black, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at 50% 30%, black, transparent 75%)" }}
      />
      {dim && <div className="absolute inset-0 bg-ink-950/50" />}
    </div>
  );
}

/* ---------------- Brand ---------------- */

export function Logo({ size = 64 }: { size?: number }) {
  return <img src="/brand-mark.png" width={size} height={size} alt="HurricaneTV" className="object-contain drop-shadow-[0_8px_28px_rgba(34,225,255,0.35)]" draggable={false} />;
}

export function Clock({ align = "right" }: { align?: "left" | "right" }) {
  const [now, setNow] = useState(Date.now());
  const h24 = useApp((s) => s.settings.timeFormat24);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn("leading-tight", align === "right" ? "text-right" : "text-left")}>
      <div className="text-2xl font-semibold tabular-nums">{fmtTime(now, h24)}</div>
      <div className="text-xs font-medium tracking-wide text-sky-100/70 capitalize">
        {new Date(now).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}

/* ---------------- Layout ---------------- */

export function ScreenHeader({ title, icon, right, children }: { title: string; icon?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  const back = useApp((s) => s.back);
  return (
    <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-white/10 bg-ink-950/40 px-6 backdrop-blur-xl">
      <button onClick={back} className="focusable grid size-10 place-items-center rounded-xl border border-white/15 bg-white/5 transition hover:bg-white/15" title={t("Voltar (Esc)")}>
        <ArrowLeft className="size-5" />
      </button>
      <div className="flex items-center gap-3">
        {icon && <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 shadow-lg shadow-blue-900/50">{icon}</div>}
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      </div>
      <div className="flex flex-1 items-center gap-3">{children}</div>
      {right}
      <Clock />
    </header>
  );
}

export function SearchBox({ value, onChange, placeholder = "Pesquisar…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <label className={cn("group relative flex h-10 items-center", className)}>
      <Search className="pointer-events-none absolute left-3 size-4 text-sky-100/50 group-focus-within:text-sky-300" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="focusable h-full w-full rounded-xl border border-white/10 bg-white/5 pr-3 pl-9 text-sm text-white placeholder:text-sky-100/40 transition focus:border-sky-400/60 focus:bg-white/10 focus:outline-none"
      />
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-sky-100/70">
      <Loader2 className="size-8 animate-spin text-sky-300" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/5 text-sky-200">{icon ?? <TriangleAlert className="size-6" />}</div>
      <div className="text-base font-semibold">{title}</div>
      {hint && <div className="max-w-md text-sm text-sky-100/60">{hint}</div>}
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  className,
  disabled,
  type = "button",
  autoFocus,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  autoFocus?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={cn(
        "focusable inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-gradient-to-b from-sky-400 to-blue-600 text-white shadow-lg shadow-blue-900/40 hover:brightness-110",
        variant === "ghost" && "border border-white/15 bg-white/5 text-white hover:bg-white/12",
        variant === "danger" && "border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Media ---------------- */

const palette = [
  ["#1d4ed8", "#38bdf8"],
  ["#7c3aed", "#c084fc"],
  ["#be123c", "#fb7185"],
  ["#047857", "#34d399"],
  ["#b45309", "#fbbf24"],
  ["#0e7490", "#22d3ee"],
  ["#4338ca", "#818cf8"],
];
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const initials = (name: string) =>
  name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function ChannelLogo({ src, name, className }: { src?: string; name: string; className?: string }) {
  const [err, setErr] = useState(false);
  const [a, b] = palette[hash(name) % palette.length];
  if (src && !err)
    return (
      <div className={cn("grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.07] p-1", className)}>
        <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className="max-h-full max-w-full object-contain" draggable={false} />
      </div>
    );
  return (
    <div className={cn("grid shrink-0 place-items-center rounded-lg text-xs font-extrabold tracking-wide", className)} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {initials(name) || t("TV")}
    </div>
  );
}

export function Poster({ src, fallback, name, className }: { src?: string; fallback?: string; name: string; className?: string }) {
  // try src, then fallback, then a generated cover
  const candidates = useMemo(() => [src, fallback].filter((x, i, a): x is string => !!x && a.indexOf(x) === i), [src, fallback]);
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [candidates]);
  const cur = candidates[failed];
  const [a, b] = useMemo(() => palette[hash(name) % palette.length], [name]);
  return (
    <div className={cn("relative overflow-hidden bg-ink-800", className)}>
      {cur ? (
        <img key={cur} src={cur} alt="" loading="lazy" onError={() => setFailed((f) => f + 1)} className="absolute inset-0 size-full object-cover" draggable={false} />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end p-3" style={{ background: `linear-gradient(160deg, ${a} 0%, ${b} 45%, #0b0d12 100%)` }}>
          <div className="absolute top-3 left-3 text-4xl font-black text-white/25">{initials(name)}</div>
          <div className="line-clamp-3 text-sm leading-tight font-bold">{name}</div>
        </div>
      )}
    </div>
  );
}

export function Rating({ value }: { value?: number }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-bold text-amber-300 backdrop-blur">
      <Star className="size-3 fill-amber-300" />
      {value.toFixed(1)}
    </span>
  );
}

export function Pill({ children, tone = "sky" }: { children: ReactNode; tone?: "sky" | "green" | "rose" | "amber" | "slate" }) {
  const tones = {
    sky: "bg-sky-400/15 text-sky-200 ring-sky-300/25",
    green: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25",
    rose: "bg-rose-400/15 text-rose-200 ring-rose-300/25",
    amber: "bg-amber-400/15 text-amber-200 ring-amber-300/25",
    slate: "bg-white/10 text-sky-50/80 ring-white/15",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase ring-1", tones[tone])}>{children}</span>;
}

/* ---------------- Category sidebar ---------------- */

export function CategoryList({
  categories,
  active,
  onSelect,
  extra,
  loading,
  parental,
}: {
  categories: { id: string; name: string; count?: number }[];
  active: string;
  onSelect: (id: string) => void;
  extra?: { id: string; name: string; icon?: ReactNode }[];
  loading?: boolean;
  /** from useParental(): lock icons, PIN on open, lock toggles */
  parental?: { enabled: boolean; unlocked: boolean; isLocked: (id: string) => boolean; guard: (id: string, fn: () => void) => void; toggle: (id: string) => void };
}) {
  const [q, setQ] = useState("");
  const list = q ? categories.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : categories;
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-white/10 bg-ink-950/35 backdrop-blur-xl">
      <div className="p-3">
        <SearchBox value={q} onChange={setQ} placeholder={t("Filtrar categorias")} />
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {extra?.map((c) => (
          <CatButton key={c.id} active={active === c.id} onClick={() => onSelect(c.id)} icon={c.icon}>
            {c.name}
          </CatButton>
        ))}
        {extra?.length ? <div className="mx-3 my-2 h-px bg-white/10" /> : null}
        {loading && Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton mx-1 my-1 h-9 rounded-lg" />)}
        {list.map((c) => (
          <CatButton
            key={c.id}
            active={active === c.id}
            onClick={() => (parental ? parental.guard(c.id, () => onSelect(c.id)) : onSelect(c.id))}
            count={c.count}
            locked={parental?.isLocked(c.id)}
            unlocked={parental?.unlocked}
            onLock={parental?.enabled ? () => parental.toggle(c.id) : undefined}
          >
            {c.name}
          </CatButton>
        ))}
      </div>
    </aside>
  );
}

function CatButton({
  active,
  onClick,
  children,
  count,
  icon,
  locked,
  unlocked,
  onLock,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  icon?: ReactNode;
  locked?: boolean;
  unlocked?: boolean;
  onLock?: () => void;
}) {
  return (
    <div className="group/cat relative">
      <button
        onClick={onClick}
        className={cn(
          "focusable flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition",
          active ? "bg-gradient-to-r from-sky-500/90 to-blue-600/90 text-white shadow-md shadow-blue-950/50" : "text-sky-50/75 hover:bg-white/8 hover:text-white",
          onLock && "pr-9",
        )}
      >
        {icon}
        {locked && (unlocked ? <LockOpen className="size-3.5 shrink-0 text-amber-300/80" /> : <Lock className="size-3.5 shrink-0 text-amber-300" />)}
        <span className="flex-1 truncate">{children}</span>
        {count != null && <span className={cn("text-[11px] tabular-nums transition", active ? "text-white/80" : "text-sky-100/40", onLock && "group-hover/cat:opacity-0")}>{count}</span>}
      </button>
      {onLock && (
        <button
          onClick={onLock}
          title={locked ? t("Desbloquear categoria") : t("Bloquear com PIN")}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-sky-100/50 opacity-0 transition group-hover/cat:opacity-100 hover:bg-white/10 hover:text-amber-300"
        >
          {locked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-white/15", className)}>
      <div className="h-full rounded-full bg-gradient-to-r from-sky-300 to-blue-500" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** Renders a growing slice of a long list as the user scrolls. */
export function useIncremental<T>(items: T[], step = 120) {
  const [n, setN] = useState(step);
  useEffect(() => setN(step), [items, step]);
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && n < items.length) setN((x) => x + step);
  };
  return { visible: items.slice(0, n), onScroll };
}

/** IMDb-style rating badge */
export function ImdbBadge({ value, size = "sm" }: { value?: number; size?: "sm" | "lg" }) {
  if (!value) return null;
  return (
    <span className={cn("inline-flex items-center overflow-hidden rounded-md font-black shadow-md shadow-black/40", size === "lg" ? "text-sm" : "text-[11px]")}>
      <span className={cn("bg-[#f5c518] text-black", size === "lg" ? "px-2 py-1" : "px-1.5 py-0.5")}>{t("IMDb")}</span>
      <span className={cn("bg-black/75 text-white tabular-nums backdrop-blur", size === "lg" ? "px-2 py-1" : "px-1.5 py-0.5")}>{value.toFixed(1)}</span>
    </span>
  );
}

export function CastRow({ cast }: { cast: { name: string; character?: string; photo?: string }[] }) {
  if (!cast.length) return null;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {cast.map((c) => (
        <div key={c.name + (c.character ?? "")} className="w-24 shrink-0 text-center">
          <Avatar src={c.photo} name={c.name} />
          <div className="mt-1.5 line-clamp-2 text-xs leading-tight font-semibold">{c.name}</div>
          {c.character && <div className="truncate text-[10px] text-sky-100/45">{c.character}</div>}
        </div>
      ))}
    </div>
  );
}

function Avatar({ src, name }: { src?: string; name: string }) {
  const [err, setErr] = useState(false);
  const [a, b] = palette[hash(name) % palette.length];
  return (
    <div className="mx-auto size-20 overflow-hidden rounded-full shadow-lg shadow-black/40 ring-2 ring-white/10">
      {src && !err ? (
        <img src={src} alt="" loading="lazy" onError={() => setErr(true)} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="grid size-full place-items-center text-lg font-extrabold" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
          {initials(name)}
        </div>
      )}
    </div>
  );
}
