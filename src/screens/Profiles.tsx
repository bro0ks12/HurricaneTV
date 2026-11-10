import { Check, Link2, Loader2, MonitorPlay, Plus, Router, Server, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button, Pill } from "../components/ui";
import { deletePlaylist, savePlaylist } from "../lib/files";
import type { Profile, ProviderKind } from "../lib/types";
import { cn, uid } from "../lib/util";
import { createProvider } from "../providers";
import { normalizeMac } from "../providers/stalker";
import { useApp } from "../store/app";

import { LANGS, t } from "../lib/i18n";
const KINDS: { id: ProviderKind; label: string; icon: ReactNode; hint: string }[] = [
  { id: "xtream", get label() { return t("Xtream Codes"); }, icon: <Server className="size-5" />, get hint() { return t("Servidor, utilizador e password"); } },
  { id: "m3u", get label() { return t("Playlist M3U"); }, icon: <Link2 className="size-5" />, get hint() { return t("URL ou ficheiro .m3u / .m3u8"); } },
  { id: "stalker", get label() { return t("Stalker Portal"); }, icon: <Router className="size-5" />, get hint() { return t("URL do portal e endereço MAC"); } },
  { id: "demo", get label() { return t("Demonstração"); }, icon: <Sparkles className="size-5" />, get hint() { return t("Streams de teste públicos"); } },
];

const kindLabel = (k: ProviderKind) => KINDS.find((x) => x.id === k)?.label ?? k;

export function Profiles({ onDone, canClose }: { onDone: () => void; canClose: boolean }) {
  const { profiles, activeId, setActive, removeProfile } = useApp();
  const [adding, setAdding] = useState(profiles.length === 0);

  return (
    <div data-focus-scope className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-ink-950/60 p-6 backdrop-blur-md">
      <div className="glass animate-fade-up w-full max-w-4xl overflow-hidden rounded-3xl shadow-2xl shadow-black/50">
        <div className="flex items-center gap-4 border-b border-white/10 px-8 py-6">
          <img src="/brand-full.png" alt="HurricaneTV" className="h-16 w-auto object-contain" draggable={false} />
          <div className="flex-1 border-l border-white/10 pl-5">
            <div className="text-sm text-sky-100/60">{adding ? t("Adicionar uma lista ou servidor IPTV") : t("Escolhe um perfil")}</div>
          </div>
          <LangSwitch />
          {canClose && !adding && (
            <Button variant="ghost" onClick={onDone}>
              {t("Fechar")}
            </Button>
          )}
        </div>

        {adding ? (
          <AddProfile
            onCancel={profiles.length ? () => setAdding(false) : undefined}
            onAdded={() => {
              setAdding(false);
              onDone();
            }}
          />
        ) : (
          <div className="p-8">
            <div className="grid grid-cols-2 gap-3">
              {profiles.map((p) => (
                <div key={p.id} className={cn("group flex items-center gap-3 rounded-2xl border p-2 pr-3 transition", p.id === activeId ? "border-sky-400/60 bg-sky-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]")}>
                  <button
                    className="focusable flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left"
                    onClick={() => {
                      setActive(p.id);
                      onDone();
                    }}
                    autoFocus={p.id === activeId}
                  >
                    <div className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-700 text-white shadow-lg shadow-blue-950/50">
                      <MonitorPlay className="size-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{p.name}</div>
                      <div className="truncate text-xs text-sky-100/55">{p.server || p.url || (p.file && t("Ficheiro: {0}", { 0: p.file })) || p.portal || t("Streams de teste")}</div>
                    </div>
                    <Pill tone={p.kind === "demo" ? "amber" : "sky"}>{kindLabel(p.kind)}</Pill>
                    {p.id === activeId && <Check className="size-5 text-sky-300" />}
                  </button>
                  <button onClick={() => removeProfile(p.id)} title={t("Remover")} className="focusable grid size-9 place-items-center rounded-lg text-sky-100/40 transition hover:bg-rose-500/15 hover:text-rose-300">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => setAdding(true)} className="focusable flex min-h-[76px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/15 text-sm font-semibold text-sky-100/70 transition hover:border-sky-400/50 hover:text-white">
                <Plus className="size-5" /> {t("Adicionar perfil")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold tracking-wider text-sky-100/60 uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sky-100/40">{hint}</span>}
    </label>
  );
}

const inputCls =
  "focusable h-11 w-full rounded-xl border border-white/12 bg-ink-950/50 px-3.5 text-sm text-white placeholder:text-sky-100/30 transition focus:border-sky-400/70 focus:bg-ink-950/70 focus:outline-none";

function AddProfile({ onAdded, onCancel }: { onAdded: () => void; onCancel?: () => void }) {
  const addProfile = useApp((s) => s.addProfile);
  const [kind, setKind] = useState<ProviderKind>("xtream");
  const [f, setF] = useState({ name: "", server: "", username: "", password: "", url: "", epgUrl: "", portal: "", mac: "00:1A:79:" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = async (f: File) => {
    setError(null);
    const text = await f.text();
    if (!/#EXTM3U|#EXTINF/i.test(text)) return setError(t("Este ficheiro não parece uma playlist M3U."));
    setFile({ name: f.name, text });
    setF((x) => ({ ...x, name: x.name || f.name.replace(/\.[^.]+$/, "") }));
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const p: Profile = {
      id: uid(),
      kind,
      name: f.name.trim() || (kind === "demo" ? t("Demonstração") : kindLabel(kind)),
      createdAt: Date.now(),
    };
    if (kind === "xtream") {
      if (!f.server || !f.username || !f.password) return setError(t("Preenche servidor, utilizador e password."));
      Object.assign(p, { server: f.server.trim(), username: f.username.trim(), password: f.password });
    } else if (kind === "m3u") {
      if (file) Object.assign(p, { file: file.name, epgUrl: f.epgUrl.trim() || undefined });
      else {
        if (!f.url.trim()) return setError(t("Indica um URL http(s) ou escolhe um ficheiro de playlist."));
        if (!/^https?:\/\//i.test(f.url.trim())) return setError(t("Indica um URL http(s) válido para a playlist."));
        Object.assign(p, { url: f.url.trim(), epgUrl: f.epgUrl.trim() || undefined });
      }
    } else if (kind === "stalker") {
      const mac = normalizeMac(f.mac);
      if (!f.portal || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) return setError(t("Indica o URL do portal e um MAC válido (00:1A:79:XX:XX:XX)."));
      Object.assign(p, { portal: f.portal.trim(), mac });
    }
    setBusy(true);
    try {
      if (p.file && file) await savePlaylist(p.id, file.text);
      const prov = createProvider(p);
      if (kind === "m3u") await prov.liveCategories();
      else await prov.account();
      addProfile(p);
      onAdded();
    } catch (err) {
      if (p.file) void deletePlaylist(p.id);
      setError(t("Não foi possível ligar: {0}", { 0: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-[260px_1fr]">
      <div className="space-y-1.5 border-r border-white/10 bg-ink-950/30 p-4">
        {KINDS.map((k) => (
          <button
            type="button"
            key={k.id}
            onClick={() => {
              setKind(k.id);
              setError(null);
            }}
            className={cn("focusable flex w-full items-center gap-3 rounded-xl p-3 text-left transition", kind === k.id ? "bg-gradient-to-r from-sky-500 to-blue-600 shadow-lg shadow-blue-950/50" : "hover:bg-white/8")}
          >
            <span className={cn("grid size-9 place-items-center rounded-lg", kind === k.id ? "bg-white/20" : "bg-white/8 text-sky-200")}>{k.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-bold">{k.label}</span>
              <span className={cn("block truncate text-[11px]", kind === k.id ? "text-white/75" : "text-sky-100/45")}>{k.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-4 p-8">
        <Field label={t("Nome do perfil")}>
          <input className={inputCls} value={f.name} onChange={set("name")} placeholder={t("Ex.: Casa, Sala, Servidor 1")} autoFocus />
        </Field>

        {kind === "xtream" && (
          <>
            <Field label={t("Servidor")} hint={t("Ex.: http://exemplo.com:8080")}>
              <input className={inputCls} value={f.server} onChange={set("server")} placeholder="http://servidor:porta" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("Utilizador")}>
                <input className={inputCls} value={f.username} onChange={set("username")} autoComplete="off" />
              </Field>
              <Field label={t("Password")}>
                <input className={inputCls} type="password" value={f.password} onChange={set("password")} autoComplete="off" />
              </Field>
            </div>
          </>
        )}
        {kind === "m3u" && (
          <>
            <Field label={t("URL da playlist")}>
              <input className={inputCls} value={f.url} onChange={set("url")} placeholder="https://…/playlist.m3u" disabled={!!file} />
            </Field>
            <Field label={t("Ficheiro da playlist")} hint={t("Escolhe um .m3u / .m3u8 do teu computador (em vez do URL acima).")}>
              <input
                ref={fileInput}
                type="file"
                accept=".m3u,.m3u8,.txt"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) void pickFile(picked);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()}>
                  <Upload className="size-4" /> {file ? file.name : t("Escolher ficheiro…")}
                </Button>
                {file && (
                  <button type="button" onClick={() => setFile(null)} title={t("Remover ficheiro")} className="focusable grid size-9 place-items-center rounded-lg bg-white/8 hover:bg-rose-500/30">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </Field>
            <Field label={t("URL do EPG (opcional)")} hint={t("XMLTV (.xml ou .xml.gz). Se vazio, usa o url-tvg da playlist.")}>
              <input className={inputCls} value={f.epgUrl} onChange={set("epgUrl")} placeholder="https://…/epg.xml.gz" />
            </Field>
          </>
        )}
        {kind === "stalker" && (
          <>
            <Field label={t("URL do portal")} hint={t("Ex.: http://portal.exemplo.com/c/")}>
              <input className={inputCls} value={f.portal} onChange={set("portal")} placeholder="http://portal:porta/c/" />
            </Field>
            <Field label={t("Endereço MAC")}>
              <input className={cn(inputCls, "font-mono tracking-wider uppercase")} value={f.mac} onChange={set("mac")} placeholder="00:1A:79:00:00:00" />
            </Field>
          </>
        )}
        {kind === "demo" && (
          <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-sm text-amber-50/80">
            {t("Cria um perfil com canais, filmes e séries de demonstração que usam vídeos de teste públicos - útil para experimentar a interface sem uma subscrição.")}
          </div>
        )}

        <p className="text-xs text-sky-100/40">
          {t("A HurricaneTV é apenas um leitor: não inclui nem fornece conteúdos. Usa só listas e serviços que tens direito a ver.")}
        </p>

        {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              {t("Cancelar")}
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {busy ? t("A ligar…") : t("Ligar e guardar")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function LangSwitch() {
  const language = useApp((s) => s.settings.language);
  const updateSettings = useApp((s) => s.updateSettings);
  return (
    <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => updateSettings({ language: l.id })}
          title={l.label}
          className={cn("focusable rounded-lg px-2.5 py-1 text-xs font-bold transition", language === l.id ? "bg-white/15 text-white" : "text-sky-100/50 hover:text-white")}
        >
          {l.flag} {l.id.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
