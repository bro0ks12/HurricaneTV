import { Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { checkForUpdate, type UpdateInfo } from "../lib/updater";

/** Bottom-right prompt shown at startup when a newer release exists on GitHub. */
export function UpdateToast() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    checkForUpdate().then(setInfo).catch(() => {});
  }, []);

  if (!info) return null;

  const run = async () => {
    setBusy(true);
    setError(false);
    try {
      await info.install(setPct);
    } catch {
      setBusy(false);
      setError(true);
    }
  };

  return (
    <div className="glass animate-fade-up fixed right-6 bottom-6 z-[90] w-80 rounded-2xl p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="bg-storm grid size-9 shrink-0 place-items-center rounded-full text-ink-950">
          <Download className="size-[18px]" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t("Nova versão disponível")}</div>
          <div className="mt-0.5 text-xs text-sky-100/60">{t("HurricaneTV {0} está pronta a instalar.", { 0: info.version })}</div>
          {error && <div className="mt-1 text-xs text-red-300">{t("Falhou a atualização. Tenta outra vez.")}</div>}
        </div>
        {!busy && (
          <button onClick={() => setInfo(null)} className="focusable rounded-lg p-1 text-sky-100/50 hover:text-white" aria-label={t("Fechar")}>
            <X className="size-4" />
          </button>
        )}
      </div>
      <button onClick={run} disabled={busy} className="focusable bg-storm mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold text-ink-950 disabled:opacity-70">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {pct ? `${pct}%` : t("A descarregar…")}
          </>
        ) : (
          t("Atualizar e reiniciar")
        )}
      </button>
    </div>
  );
}
