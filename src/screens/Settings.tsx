import { Clock3, Eraser, EyeOff, Info, MonitorPlay, PlayCircle, Settings as Cog } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, ScreenHeader } from "../components/ui";
import { clearCache } from "../lib/query";
import { cn } from "../lib/util";
import { resetProviders, useApp } from "../store/app";

export function Settings() {
  const { settings, updateSettings } = useApp();
  const [cleared, setCleared] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Definições" icon={<Cog className="size-5" />} />
      <div className="min-h-0 flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Section title="Reprodução">
            <Row icon={<MonitorPlay />} title="Formato dos canais em direto" hint="HLS (.m3u8) é mais compatível; MPEG-TS (.ts) tem menos latência. Aplica-se a servidores Xtream.">
              <Segmented value={settings.liveFormat} onChange={(v) => updateSettings({ liveFormat: v })} options={[{ v: "m3u8", l: "HLS" }, { v: "ts", l: "MPEG-TS" }]} />
            </Row>
            <Row icon={<PlayCircle />} title="Pré-visualização automática" hint="Reproduz o canal selecionado na lista de TV em Direto.">
              <Toggle value={settings.autoplayPreview} onChange={(v) => updateSettings({ autoplayPreview: v })} />
            </Row>
          </Section>

          <Section title="Interface">
            <Row icon={<Clock3 />} title="Formato de hora">
              <Segmented value={settings.timeFormat24 ? "24" : "12"} onChange={(v) => updateSettings({ timeFormat24: v === "24" })} options={[{ v: "24", l: "24h" }, { v: "12", l: "12h" }]} />
            </Row>
            <Row icon={<EyeOff />} title="Ocultar conteúdo adulto" hint="Esconde categorias marcadas como adultas/XXX.">
              <Toggle value={settings.hideAdult} onChange={(v) => updateSettings({ hideAdult: v })} />
            </Row>
          </Section>

          <Section title="Dados">
            <Row icon={<Eraser />} title="Limpar cache" hint="Volta a descarregar listas de canais, filmes e EPG.">
              <Button
                variant="ghost"
                onClick={() => {
                  clearCache();
                  resetProviders();
                  setCleared(true);
                }}
              >
                {cleared ? "Limpo ✓" : "Limpar"}
              </Button>
            </Row>
          </Section>

          <Section title="Sobre">
            <Row icon={<Info />} title="NexoTV 0.1.0" hint="Leitor IPTV para Xtream Codes, M3U e Stalker. Não fornece conteúdos.">
              <span />
            </Row>
            <div className="px-5 pb-4 text-xs leading-relaxed text-sky-100/45">
              Atalhos: setas para navegar · Enter para abrir · Esc/Backspace para voltar · no leitor: Espaço pausa, F ecrã inteiro, M silêncio, ↑/↓ muda de canal, números para ir direto a um canal.
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
