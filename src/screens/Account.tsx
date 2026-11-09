import { CalendarCheck, CalendarX, Link2, MonitorSmartphone, ShieldCheck, UserRound, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Empty, Pill, ScreenHeader, Spinner } from "../components/ui";
import { useQuery } from "../lib/query";
import { fmtDate } from "../lib/util";
import { useProfile, useProvider } from "../store/app";

import { t, tn } from "../lib/i18n";
export function Account({ onSwitchProfile }: { onSwitchProfile: () => void }) {
  const profile = useProfile()!;
  const provider = useProvider()!;
  const acc = useQuery(`acc:${profile.id}`, () => provider.account());
  const a = acc.data;
  const days = a?.expires ? Math.ceil((a.expires - Date.now()) / 864e5) : null;
  const active = (a?.status ?? "").toLowerCase() === "active";

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={t("Conta")} icon={<UserRound className="size-5" />} right={<Button variant="ghost" onClick={onSwitchProfile}><Users className="size-4" /> {t("Mudar perfil")}</Button>} />
      <div className="min-h-0 flex-1 overflow-y-auto p-8">
        {acc.loading ? (
          <Spinner label={t("A obter dados da conta…")} />
        ) : acc.error ? (
          <Empty title={t("Não foi possível obter a conta")} hint={acc.error} action={<Button onClick={acc.refetch}>{t("Tentar de novo")}</Button>} />
        ) : (
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="glass flex items-center gap-5 rounded-3xl p-6">
              <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-700 shadow-xl shadow-blue-950/50">
                <UserRound className="size-8" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-2xl font-extrabold">{profile.name}</div>
                <div className="truncate text-sm text-sky-100/55">{profile.username ? `${profile.username} · ` : ""}{a?.serverUrl}</div>
              </div>
              <Pill tone={active ? "green" : "rose"}>{a?.status ? statusLabel(a.status) : "—"}</Pill>
              {a?.isTrial && <Pill tone="amber">{t("Teste")}</Pill>}
            </div>

            <div className="grid grid-cols-3 gap-4">
              <Stat icon={days != null && days < 7 ? <CalendarX /> : <CalendarCheck />} label={t("Expira")} value={a?.expires ? fmtDate(a.expires) : t("Ilimitado")} hint={days != null ? tn(days, "1 dia restante", "{n} dias restantes") : undefined} tone={days != null && days < 7 ? "rose" : "sky"} />
              <Stat icon={<MonitorSmartphone />} label={t("Ligações")} value={a?.maxConnections != null ? `${a.activeConnections ?? 0} / ${a.maxConnections}` : "—"} hint={t("ativas / máximo")} />
              <Stat icon={<ShieldCheck />} label={t("Criada em")} value={a?.createdAt ? fmtDate(a.createdAt) : "—"} hint={a?.timezone} />
            </div>

            {a?.extra && (
              <div className="glass overflow-hidden rounded-2xl">
                {Object.entries(a.extra).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-4 border-b border-white/5 px-5 py-3.5 last:border-0">
                    <span className="w-32 text-sm text-sky-100/50">{t(k)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-sky-100/40">
              <Link2 className="size-3.5" /> {t("Tipo de fonte:")} {profile.kind.toUpperCase()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, hint, tone = "sky" }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: "sky" | "rose" }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className={tone === "rose" ? "text-rose-300 [&>svg]:size-6" : "text-sky-300 [&>svg]:size-6"}>{icon}</div>
      <div className="mt-3 text-xs font-bold tracking-widest text-sky-100/50 uppercase">{label}</div>
      <div className="mt-1 text-xl font-extrabold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-sky-100/45">{hint}</div>}
    </div>
  );
}

/** Server status text (Xtream sends English words) in the UI language. */
function statusLabel(s: string) {
  const k = s.trim().toLowerCase();
  return k === "active" ? t("Ativa") : k === "expired" ? t("Expirada") : k === "banned" ? t("Banida") : k === "disabled" ? t("Desativada") : s;
}
