import { Captions, Clock3, Database, Eraser, ExternalLink, EyeOff, Info, KeyRound, Link2, Loader2, Lock, LockOpen, MonitorPlay, PlayCircle, Languages, Settings as Cog, ShieldCheck, Download, FolderOpen, Upload, SquareDashed, Type, Unlink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, QrCode, ScreenHeader } from "../components/ui";
import { clearMetaCache } from "../lib/meta";
import { pollDeviceToken, requestDeviceCode, unlinkDevice, type DeviceCode } from "../lib/movexa";
import { flushMovexa } from "../lib/scrobble";
import { applyBackup, buildBackup, parseBackup, revealFile, saveBackup, type BackupFile } from "../lib/backup";
import { askPin, chooseNewPin, hashPin } from "../lib/parental";
import { clearCache } from "../lib/query";
import { cn } from "../lib/util";
import { resetProviders, useApp } from "../store/app";

import { LANGS, locale, t, tn } from "../lib/i18n";
export function Settings() {
  const { settings, updateSettings } = useApp();
  const [cleared, setCleared] = useState(false);
  const [metaCleared, setMetaCleared] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("Definições")} icon={<Cog className="size-5" />} />
      <div className="min-h-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Section title={t("Reprodução")}>
            <Row icon={<MonitorPlay />} title={t("Formato dos canais em direto")} hint={t("HLS (.m3u8) é mais compatível; MPEG-TS (.ts) tem menos latência. Aplica-se a servidores Xtream.")}>
              <Segmented value={settings.liveFormat} onChange={(v) => updateSettings({ liveFormat: v })} options={[{ v: "m3u8", l: t("HLS") }, { v: "ts", l: t("MPEG-TS") }]} />
            </Row>
            <Row icon={<PlayCircle />} title={t("Pré-visualização automática")} hint={t("Reproduz o canal selecionado na lista de TV em Direto.")}>
              <Toggle value={settings.autoplayPreview} onChange={(v) => updateSettings({ autoplayPreview: v })} />
            </Row>
            <Row icon={<ExternalLink />} title={t("Leitor externo")} hint={t("Para codecs que o leitor interno não suporta (HEVC, AC-3, MKV com legendas). Vazio = deteta VLC/mpv automaticamente.")}>
              <input
                value={settings.externalPlayer}
                onChange={(e) => updateSettings({ externalPlayer: e.target.value })}
                placeholder={t("C:\\Program Files\\VideoLAN\\VLC\\vlc.exe")}
                className="focusable h-10 w-72 rounded-xl border border-white/12 bg-ink-950/50 px-3 text-xs text-white placeholder:text-sky-100/30 focus:border-sky-400/70 focus:outline-none"
              />
            </Row>
          </Section>

          <Section title={t("Legendas")}>
            <Row icon={<Captions />} title={t("Idioma preferido")} hint={t("Ativa automaticamente as legendas neste idioma quando o stream as tiver.")}>
              <Segmented
                value={settings.subLang}
                onChange={(v) => updateSettings({ subLang: v })}
                options={[
                  { v: "", l: t("Nenhum") },
                  { v: "pt", l: t("PT") },
                  { v: "en", l: t("EN") },
                  { v: "es", l: t("ES") },
                  { v: "fr", l: t("FR") },
                ]}
              />
            </Row>
            <Row icon={<Type />} title={t("Tamanho do texto")}>
              <Segmented
                value={String(settings.subSize)}
                onChange={(v) => updateSettings({ subSize: Number(v) })}
                options={[
                  { v: "75", l: t("P") },
                  { v: "100", l: t("M") },
                  { v: "130", l: t("G") },
                  { v: "160", l: t("XG") },
                ]}
              />
            </Row>
            <Row icon={<SquareDashed />} title={t("Fundo atrás do texto")} hint={t("Melhora a leitura em cenas claras.")}>
              <Toggle value={settings.subBackground} onChange={(v) => updateSettings({ subBackground: v })} />
            </Row>
            <div className="flex justify-center bg-black/40 px-5 py-6">
              <span
                className="rounded px-2 py-0.5 text-center font-semibold [text-shadow:0_0_4px_rgba(0,0,0,.9),0_2px_3px_rgba(0,0,0,.9)]"
                style={{ fontSize: `${(settings.subSize / 100) * 22}px`, background: settings.subBackground ? "rgba(0,0,0,0.62)" : "transparent" }}
              >
                {t("Exemplo de legenda - assim vai aparecer.")}
              </span>
            </div>
          </Section>

          <MovexaSection />

          <ParentalSection />

          <BackupSection />

          <Section title={t("Interface")}>
            <Row icon={<Languages />} title={t("Idioma da interface")} hint={t("Muda a língua de toda a app.")}>
              <Segmented value={settings.language} onChange={(v) => updateSettings({ language: v })} options={LANGS.map((l) => ({ v: l.id, l: `${l.flag} ${l.label}` }))} />
            </Row>
            <Row icon={<Clock3 />} title={t("Formato de hora")}>
              <Segmented value={settings.timeFormat24 ? "24" : "12"} onChange={(v) => updateSettings({ timeFormat24: v === "24" })} options={[{ v: "24", l: "24h" }, { v: "12", l: "12h" }]} />
            </Row>
            <Row icon={<EyeOff />} title={t("Ocultar conteúdo adulto")} hint={t("Esconde categorias marcadas como adultas/XXX.")}>
              <Toggle value={settings.hideAdult} onChange={async (v) => (v || (await askPin(t("Mostrar conteúdo adulto")))) && updateSettings({ hideAdult: v })} />
            </Row>
          </Section>

          <Section title={t("Metadados")}>
            <Row icon={<Database />} title={t("Capas, sinopses, IMDb e elenco")} hint={t("Procura cada filme e série numa base de dados online (Cinemeta) e completa o que o fornecedor não traz.")}>
              <Toggle value={settings.metadata} onChange={(v) => updateSettings({ metadata: v })} />
            </Row>
            <Row icon={<Eraser />} title={t("Limpar cache de metadados")} hint={t("Volta a procurar capas e informação.")}>
              <Button
                variant="ghost"
                onClick={() => {
                  clearMetaCache();
                  setMetaCleared(true);
                }}
              >
                {metaCleared ? t("Limpo ✓") : t("Limpar")}
              </Button>
            </Row>
          </Section>

          <Section title={t("Dados")}>
            <Row icon={<Eraser />} title={t("Limpar cache")} hint={t("Volta a descarregar listas de canais, filmes e EPG.")}>
              <Button
                variant="ghost"
                onClick={() => {
                  clearCache();
                  resetProviders();
                  setCleared(true);
                }}
              >
                {cleared ? t("Limpo ✓") : t("Limpar")}
              </Button>
            </Row>
          </Section>

          <Section title={t("Sobre")}>
            <Row icon={<Info />} title={t("HurricaneTV {0}", { 0: __APP_VERSION__ })} hint={t("Leitor IPTV para Xtream Codes, M3U e Stalker. Não fornece conteúdos.")}>
              <span />
            </Row>
            <div className="px-5 pb-4 text-xs leading-relaxed text-sky-100/45">
              {t("Atalhos: setas para navegar · Enter para abrir · Esc/Backspace para voltar · no leitor: Espaço pausa, F ecrã inteiro, M silêncio, C legendas, G/H sincronizar legendas, ↑/↓ muda de canal, números para ir direto a um canal.")}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 px-1 text-xs font-bold tracking-widest text-sky-100/50 uppercase">{title}</div>
      <div className="glass divide-y divide-white/5 overflow-hidden rounded-2xl">{children}</div>
    </section>
  );
}

function Row({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300 [&>svg]:size-5">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {hint && <div className="text-xs text-sky-100/50">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={value} onClick={() => onChange(!value)} className={cn("focusable relative h-7 w-12 rounded-full transition", value ? "bg-sky-500" : "bg-white/15")}>
      <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-all", value ? "left-6" : "left-1")} />
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
      {options.map((o) => (
        <button key={o.v} onClick={() => onChange(o.v)} className={cn("focusable rounded-lg px-3 py-1.5 text-xs font-bold transition", value === o.v ? "bg-sky-500 text-white" : "text-sky-100/60 hover:text-white")}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

type LinkState =
  | { step: "idle" }
  | { step: "requesting" }
  | { step: "waiting"; code: DeviceCode; until: number }
  | { step: "expired" };

function MovexaSection() {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.activeId) ?? null);
  const link = useApp((s) => (s.activeId ? s.movexa[s.activeId] : undefined));
  const pending = useApp((s) => (s.activeId ? (s.movexaQueue[s.activeId]?.length ?? 0) : 0));
  const setLink = useApp((s) => s.setMovexaLink);
  const [state, setState] = useState<LinkState>({ step: "idle" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pid = profile?.id;

  const start = async () => {
    if (!profile) return;
    setMsg(null);
    setState({ step: "requesting" });
    try {
      const code = await requestDeviceCode(`HurricaneTV · ${profile.name}`);
      setState({ step: "waiting", code, until: Date.now() + code.expires_in * 1000 });
    } catch {
      setState({ step: "idle" });
      setMsg({ ok: false, text: t("Não foi possível contactar o Movexa. Verifica a ligação à internet.") });
    }
  };

  const waiting = state.step === "waiting" ? state : null;
  useEffect(() => {
    if (!waiting || !pid) return;
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (Date.now() > waiting.until) return alive && setState({ step: "expired" });
      const r = await pollDeviceToken(waiting.code.device_code).catch(() => ({ status: "pending" as const }));
      if (!alive) return;
      if (r.status === "linked") {
        setLink(pid, r.link);
        setState({ step: "idle" });
        setMsg({ ok: true, text: t("Perfil ligado ao Movexa.") });
      } else if (r.status === "denied") {
        setState({ step: "idle" });
        setMsg({ ok: false, text: t("O pedido foi recusado no Movexa.") });
      } else if (r.status === "expired") {
        setState({ step: "expired" });
      } else {
        timer = window.setTimeout(tick, waiting.code.interval * 1000);
      }
    };
    timer = window.setTimeout(tick, waiting.code.interval * 1000);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [waiting, pid, setLink]);

  const disconnect = () => {
    if (!pid || !link) return;
    void unlinkDevice(link.token);
    setLink(pid, null);
    setMsg(null);
  };

  return (
    <Section title={t("Movexa")}>
      {link ? (
        <Row
          icon={<Link2 />}
          title={link.user ? t("Ligado ao Movexa como {0}", { 0: link.user }) : t("Ligado ao Movexa")}
          hint={
            t("Os filmes e episódios que vês até ao fim ficam marcados como vistos no teu histórico do Movexa.") +
            (pending ? " " + tn(pending, "1 título por enviar.", "{n} títulos por enviar.") : "")
          }
        >
          <div className="flex gap-2">
            {pending > 0 && (
              <Button variant="ghost" onClick={() => pid && flushMovexa(pid)}>
                {t("Enviar agora")}
              </Button>
            )}
            <Button variant="danger" onClick={disconnect}>
              <Unlink className="size-4" /> {t("Desligar")}
            </Button>
          </div>
        </Row>
      ) : waiting ? (
        <div className="flex flex-wrap items-center gap-6 px-5 py-5">
          <QrCode value={waiting.code.verification_uri_complete} label={t("QR code para ligar ao Movexa")} className="size-44 shrink-0 p-1" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="text-sm font-semibold">{t("Lê o QR code com o telemóvel")}</div>
            <div className="text-xs text-sky-100/60">{t("Ou abre {0} e introduz este código:", { 0: waiting.code.verification_uri.replace(/^https?:\/\//, "") })}</div>
            <div className="font-mono text-3xl font-bold tracking-[0.2em]">{waiting.code.user_code}</div>
            <div className="flex items-center gap-2 text-xs text-sky-100/50">
              <Loader2 className="size-3.5 animate-spin" /> {t("À espera de confirmação…")}
            </div>
          </div>
          <Button variant="ghost" onClick={() => setState({ step: "idle" })}>
            {t("Cancelar")}
          </Button>
        </div>
      ) : (
        <Row
          icon={<Link2 />}
          title={state.step === "expired" ? t("O código expirou") : t("Ligar ao Movexa")}
          hint={t("Liga este perfil ao Movexa com um QR code para manter o teu histórico sincronizado com as tuas outras apps.")}
        >
          <Button onClick={start} disabled={state.step === "requesting"}>
            {state.step === "requesting" && <Loader2 className="size-4 animate-spin" />}
            {state.step === "expired" ? t("Gerar novo código") : t("Ligar")}
          </Button>
        </Row>
      )}
      {msg && <div className={cn("px-5 py-3 text-sm font-semibold", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</div>}
    </Section>
  );
}

function ParentalSection() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const until = useApp((s) => s.parentalUntil);
  const setUntil = useApp((s) => s.setParentalUntil);
  const lockedCount = useApp((s) => (s.lockedCats[s.activeId ?? "_"] ?? []).length);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const on = !!settings.parentalPinHash;
  const unlocked = on && Date.now() < until;

  const say = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3500);
  };
  const setPin = async () => {
    if (on && !(await askPin(t("PIN atual")))) return;
    const pin = await chooseNewPin();
    if (!pin) return say(false, t("Os PINs não coincidem. Nada foi alterado."));
    updateSettings({ parentalPinHash: await hashPin(pin) });
    setUntil(0);
    say(true, on ? t("PIN alterado.") : t("Controlo parental ativado."));
  };
  const disable = async () => {
    if (!(await askPin(t("Desativar controlo parental")))) return;
    updateSettings({ parentalPinHash: "" });
    setUntil(0);
    say(true, t("Controlo parental desativado."));
  };

  return (
    <Section title={t("Controlo parental")}>
      <Row
        icon={<ShieldCheck />}
        title={on ? t("Protegido com PIN") : t("PIN de controlo parental")}
        hint={on ? tn(lockedCount, "1 categoria bloqueada neste perfil", "{n} categorias bloqueadas neste perfil") + (settings.parentalLockAdult ? t(" + conteúdo adulto") : "") + "." : t("Bloqueia categorias com um PIN de 4 dígitos.")}
      >
        <div className="flex gap-2">
          <Button variant={on ? "ghost" : "primary"} onClick={setPin}>
            <KeyRound className="size-4" /> {on ? t("Alterar PIN") : t("Definir PIN")}
          </Button>
          {on && (
            <Button variant="danger" onClick={disable}>
              {t("Desativar")}
            </Button>
          )}
        </div>
      </Row>
      {on && (
        <>
          <Row icon={<Lock />} title={t("Bloquear conteúdo adulto")} hint={t("Categorias adultas/XXX pedem sempre o PIN (desliga também “Ocultar conteúdo adulto” para as veres na lista).")}>
            <Toggle value={settings.parentalLockAdult} onChange={async (v) => (v || (await askPin())) && updateSettings({ parentalLockAdult: v })} />
          </Row>
          <Row
            icon={unlocked ? <LockOpen /> : <Lock />}
            title={unlocked ? t("Desbloqueado temporariamente") : t("Bloqueado")}
            hint={unlocked ? t("Volta a bloquear às {0}.", { 0: new Date(until).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }) : t("Para bloquear uma categoria, passa o rato por cima dela na lista e carrega no cadeado.")}
          >
            {unlocked && (
              <Button variant="ghost" onClick={() => setUntil(0)}>
                <Lock className="size-4" /> {t("Bloquear já")}
              </Button>
            )}
          </Row>
        </>
      )}
      {msg && <div className={cn("px-5 py-3 text-sm font-semibold", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</div>}
    </Section>
  );
}

function BackupSection() {
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.activeId);
  const [sel, setSel] = useState<string[]>(() => profiles.map((p) => p.id));
  const [favorites, setFavorites] = useState(true);
  const [withSettings, setWithSettings] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const doExport = async () => {
    if (!sel.length) return setMsg({ ok: false, text: t("Escolhe pelo menos um perfil.") });
    try {
      const where = await saveBackup(buildBackup({ profileIds: sel, favorites, settings: withSettings }));
      setSaved(where);
      setMsg({ ok: true, text: t("Backup guardado.") });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };
  const onFile = async (f: File) => {
    try {
      setPending(parseBackup(await f.text()));
      setMsg(null);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const doImport = (applySettings: boolean) => {
    if (!pending) return;
    const n = applyBackup(pending, applySettings);
    setPending(null);
    setMsg({ ok: true, text: tn(n, "1 perfil importado.", "{n} perfis importados.") });
  };

  return (
    <Section title={t("Backup e partilha")}>
      <div className="space-y-3 px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
            <Download className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t("Exportar perfis")}</div>
            <div className="text-xs text-sky-100/50">{t("Guarda um ficheiro .json na pasta Transferências. Serve para mudar de PC ou passar a tua lista a um amigo. O PIN nunca é incluído.")}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={cn("focusable rounded-lg border px-3 py-1.5 text-xs font-semibold transition", sel.includes(p.id) ? "border-sky-300/50 bg-sky-400/15 text-white" : "border-white/10 text-sky-100/50 hover:text-white")}
                >
                  {sel.includes(p.id) ? "✓ " : ""}
                  {p.name}
                  {p.id === activeId ? t(" (atual)") : ""}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-sky-100/70">
              <label className="flex items-center gap-2">
                <Toggle value={favorites} onChange={setFavorites} /> {t("Favoritos, histórico e bloqueios")}
              </label>
              <label className="flex items-center gap-2">
                <Toggle value={withSettings} onChange={setWithSettings} /> {t("Definições")}
              </label>
            </div>
            <p className="mt-2 text-[11px] text-amber-200/70">{t("Atenção: o ficheiro contém os dados de acesso dos perfis (servidor, utilizador e password). Partilha-o só com quem confias.")}</p>
          </div>
          <Button onClick={doExport}>
            <Download className="size-4" /> {t("Exportar")}
          </Button>
        </div>
        {saved && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-400/10 px-4 py-2.5 text-xs text-emerald-100">
            <span className="min-w-0 flex-1 truncate">{t("Guardado em")} {saved}</span>
            <button onClick={() => revealFile(saved)} className="focusable flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 font-semibold hover:bg-white/20">
              <FolderOpen className="size-3.5" /> {t("Mostrar")}
            </button>
          </div>
        )}
      </div>

      <Row icon={<Upload />} title={t("Importar backup")} hint={t("Junta os perfis do ficheiro aos que já tens (perfis iguais são atualizados).")}>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" /> {t("Escolher ficheiro…")}
        </Button>
      </Row>

      {pending && (
        <div className="mx-5 mb-4 rounded-2xl border border-sky-300/25 bg-sky-400/[0.07] p-4">
          <div className="text-sm font-semibold">
            {tn(pending.profiles.length, "1 perfil neste ficheiro", "{n} perfis neste ficheiro")} · {t("versão")} {pending.version} · {new Date(pending.exportedAt).toLocaleDateString(locale())}
          </div>
          <div className="mt-1 text-xs text-sky-100/60">{pending.profiles.map((p) => p.name).join(", ")}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => doImport(false)}>{t("Importar perfis")}</Button>
            {pending.settings && (
              <Button variant="ghost" onClick={() => doImport(true)}>
                {t("Importar perfis e definições")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPending(null)}>
              {t("Cancelar")}
            </Button>
          </div>
        </div>
      )}
      {msg && <div className={cn("px-5 pb-4 text-sm font-semibold", msg.ok ? "text-emerald-300" : "text-rose-300")}>{msg.text}</div>}
    </Section>
  );
}
