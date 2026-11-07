/**
 * Parental control: a 4-digit PIN guards locked categories (and, optionally,
 * every adult category). Unlocking lasts UNLOCK_MINUTES for the whole app.
 */
import { Delete, Lock, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../store/app";
import { isAdult } from "./settings";
import { cn } from "./util";

import { t } from "./i18n";
export type LockKind = "live" | "vod" | "series";
const UNLOCK_MINUTES = 30;
const EMPTY: string[] = [];
const NONE = new Set<string>();

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`hurricanetv:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- PIN prompt (one global dialog) ---------------- */

type Req = { title: string; hint?: string; mode: "check" | "set"; resolve: (v: string | null) => void };
let listener: ((r: Req | null) => void) | null = null;

function open(title: string, mode: "check" | "set", hint?: string) {
  return new Promise<string | null>((resolve) => {
    if (!listener) return resolve(null);
    listener({ title, hint, mode, resolve });
  });
}

/** Ask for the PIN. Resolves true when correct (or when no PIN is configured). */
export async function askPin(title?: string): Promise<boolean> {
  title ??= t("Conteúdo bloqueado");
  const { settings, parentalUntil, setParentalUntil } = useApp.getState();
  if (!settings.parentalPinHash || Date.now() < parentalUntil) return true;
  const pin = await open(title, "check", t("Introduz o PIN do controlo parental"));
  if (pin == null) return false;
  if ((await hashPin(pin)) !== settings.parentalPinHash) return false;
  setParentalUntil(Date.now() + UNLOCK_MINUTES * 60_000);
  return true;
}

/** Ask for a new PIN twice. Resolves the PIN or null if cancelled / mismatched. */
export async function chooseNewPin(): Promise<string | null> {
  const a = await open(t("Novo PIN"), "set", t("Escolhe 4 dígitos"));
  if (a == null) return null;
  const b = await open(t("Confirma o PIN"), "set", t("Repete os mesmos 4 dígitos"));
  if (b !== a) return null;
  return a;
}

export function PinHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => {
    listener = (r) => {
      setPin("");
      setReq(r);
    };
    return () => {
      listener = null;
    };
  }, []);

  const finish = useCallback(
    (v: string | null) => {
      req?.resolve(v);
      setReq(null);
      setPin("");
    },
    [req],
  );

  const submit = useCallback(
    async (p: string) => {
      if (!req) return;
      if (req.mode === "check") {
        const ok = (await hashPin(p)) === useApp.getState().settings.parentalPinHash;
        if (!ok) {
          setShake(true);
          setTimeout(() => {
            setShake(false);
            setPin("");
          }, 450);
          return;
        }
      }
      finish(p);
    },
    [req, finish],
  );

  const press = useCallback((d: string) => setPin((cur) => (cur + d).slice(0, 4)), []);

  // submit once 4 digits are in (kept out of the state updater: StrictMode runs those twice)
  useEffect(() => {
    if (pin.length !== 4) return;
    const t = setTimeout(() => submit(pin), 120);
    return () => clearTimeout(t);
  }, [pin, submit]);

  useEffect(() => {
    if (!req) return;
    const k = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Escape") finish(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [req, press, finish]);

  if (!req) return null;
  return (
    <div data-focus-scope className="fixed inset-0 z-[70] grid place-items-center bg-ink-950/75 backdrop-blur-md animate-fade-up" onClick={() => finish(null)}>
      <div className={cn("glass relative w-[340px] rounded-3xl p-7 text-center shadow-2xl shadow-black/60", shake && "animate-[shake_.4s]")} onClick={(e) => e.stopPropagation()}>
        <button onClick={() => finish(null)} className="focusable absolute top-4 right-4 grid size-9 place-items-center rounded-xl text-sky-100/50 hover:bg-white/10 hover:text-white">
          <X className="size-4" />
        </button>
        <div className="bg-storm mx-auto mb-4 grid size-14 place-items-center rounded-2xl text-ink-950 shadow-[0_10px_30px_-8px_rgba(34,225,255,0.6)]">
          {req.mode === "set" ? <ShieldCheck className="size-7" /> : <Lock className="size-7" />}
        </div>
        <h2 className="text-xl font-bold">{req.title}</h2>
        {req.hint && <p className="mt-1 text-sm text-sky-100/55">{req.hint}</p>}
        <div className="my-6 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("size-4 rounded-full border-2 transition", i < pin.length ? "border-sky-300 bg-sky-300 shadow-[0_0_12px_#22e1ff]" : "border-white/25", shake && "border-rose-400 bg-rose-400")} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Key key={d} onClick={() => press(d)} autoFocus={d === "1"}>
              {d}
            </Key>
          ))}
          <span />
          <Key onClick={() => press("0")}>0</Key>
          <Key onClick={() => setPin((p) => p.slice(0, -1))} label={t("Apagar")}>
            <Delete className="size-5" />
          </Key>
        </div>
      </div>
    </div>
  );
}

function Key({ children, onClick, autoFocus, label }: { children: React.ReactNode; onClick: () => void; autoFocus?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      autoFocus={autoFocus}
      aria-label={label}
      className="focusable grid h-14 place-items-center rounded-2xl bg-white/[0.06] text-xl font-semibold transition hover:bg-white/[0.12] active:scale-95"
    >
      {children}
    </button>
  );
}

/* ---------------- hook used by the screens ---------------- */

/**
 * `isLocked(cat)` → category needs the PIN; `hidden` → ids whose items must be
 * left out of aggregated lists ("Todos", search, home) while still locked.
 */
export function useParental(kind: LockKind, categories: { id: string; name: string }[] | undefined) {
  const enabled = useApp((s) => !!s.settings.parentalPinHash);
  const lockAdult = useApp((s) => s.settings.parentalLockAdult);
  const keys = useApp((s) => s.lockedCats[s.activeId ?? "_"] ?? EMPTY);
  const until = useApp((s) => s.parentalUntil);
  const toggleLock = useApp((s) => s.toggleLock);
  const [, tick] = useState(0);

  // re-lock automatically when the unlock window ends
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setTimeout(() => tick((x) => x + 1), until - Date.now() + 50);
    return () => clearTimeout(t);
  }, [until]);

  const unlocked = Date.now() < until;
  const lockedIds = useMemo(() => {
    const out = new Set<string>();
    if (!enabled) return out;
    for (const k of keys) if (k.startsWith(kind + ":")) out.add(k.slice(kind.length + 1));
    if (lockAdult) for (const c of categories ?? []) if (isAdult(c.name)) out.add(c.id);
    return out;
  }, [enabled, keys, kind, lockAdult, categories]);

  return {
    enabled,
    unlocked,
    isLocked: (id: string) => lockedIds.has(id),
    hidden: unlocked ? NONE : lockedIds,
    /** run `fn` only if the category is open or the PIN is entered */
    guard: async (id: string, fn: () => void) => {
      if (!lockedIds.has(id) || (await askPin())) fn();
    },
    toggle: async (id: string) => {
      if (await askPin(t("Alterar bloqueio"))) toggleLock(`${kind}:${id}`);
    },
  };
}
