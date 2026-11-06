import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultSettings, setSettingsRef, type Settings } from "../lib/settings";
import type { Channel, Profile, Provider, SeriesItem, VodItem } from "../lib/types";
import { createProvider } from "../providers";

export type Screen =
  | "home"
  | "live"
  | "epg"
  | "vod"
  | "series"
  | "catchup"
  | "multi"
  | "favorites"
  | "radio"
  | "account"
  | "settings"
  | "search";

export interface PlayRequest {
  title: string;
  subtitle?: string;
  stream: string;
  type: "live" | "vod" | "episode" | "url";
  /** live zapping list */
  channels?: Channel[];
  index?: number;
  poster?: string;
}

interface Favs {
  live: Channel[];
  vod: VodItem[];
  series: SeriesItem[];
}

export interface HistoryEntry {
  key: string;
  title: string;
  poster?: string;
  play: PlayRequest;
  position?: number;
  duration?: number;
  at: number;
}

interface State {
  profiles: Profile[];
  activeId: string | null;
  settings: Settings;
  favs: Record<string, Favs>;
  history: Record<string, HistoryEntry[]>;
  // volatile
  stack: Screen[];
  playing: PlayRequest | null;
  addProfile(p: Profile): void;
  removeProfile(id: string): void;
  setActive(id: string | null): void;
  updateSettings(s: Partial<Settings>): void;
  go(s: Screen): void;
  back(): void;
  home(): void;
  play(r: PlayRequest | null): void;
  toggleFav(kind: keyof Favs, item: Channel | VodItem | SeriesItem): void;
  isFav(kind: keyof Favs, id: string): boolean;
  pushHistory(e: HistoryEntry): void;
}

const emptyFavs = (): Favs => ({ live: [], vod: [], series: [] });

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeId: null,
      settings: defaultSettings,
      favs: {},
      history: {},
      stack: ["home"],
      playing: null,
      addProfile: (p) => set((s) => ({ profiles: [...s.profiles.filter((x) => x.id !== p.id), p], activeId: p.id, stack: ["home"] })),
      removeProfile: (id) =>
        set((s) => {
          const profiles = s.profiles.filter((x) => x.id !== id);
          return { profiles, activeId: s.activeId === id ? (profiles[0]?.id ?? null) : s.activeId };
        }),
      setActive: (id) => set({ activeId: id, stack: ["home"] }),
      updateSettings: (patch) =>
        set((s) => {
          const settings = { ...s.settings, ...patch };
          setSettingsRef(settings);
          return { settings };
        }),
      go: (screen) => set((s) => ({ stack: [...s.stack, screen] })),
      back: () => set((s) => ({ stack: s.stack.length > 1 ? s.stack.slice(0, -1) : s.stack })),
      home: () => set({ stack: ["home"] }),
      play: (r) => set({ playing: r }),
      toggleFav: (kind, item) =>
        set((s) => {
          const pid = s.activeId ?? "_";
          const f = s.favs[pid] ?? emptyFavs();
          const list = f[kind] as { id: string }[];
          const next = list.some((x) => x.id === item.id) ? list.filter((x) => x.id !== item.id) : [...list, item];
          return { favs: { ...s.favs, [pid]: { ...f, [kind]: next } } };
        }),
      isFav: (kind, id) => {
        const s = get();
        return (s.favs[s.activeId ?? "_"]?.[kind] as { id: string }[] | undefined)?.some((x) => x.id === id) ?? false;
      },
      pushHistory: (e) =>
        set((s) => {
          const pid = s.activeId ?? "_";
          const list = (s.history[pid] ?? []).filter((x) => x.key !== e.key);
          return { history: { ...s.history, [pid]: [e, ...list].slice(0, 40) } };
        }),
    }),
    {
      name: "nexotv",
      partialize: (s) => ({ profiles: s.profiles, activeId: s.activeId, settings: s.settings, favs: s.favs, history: s.history }),
      onRehydrateStorage: () => (s) => {
        if (s) setSettingsRef({ ...defaultSettings, ...s.settings });
      },
    },
  ),
);

export const useScreen = () => useApp((s) => s.stack[s.stack.length - 1]);
export const useProfile = () => useApp((s) => s.profiles.find((p) => p.id === s.activeId) ?? null);
const EMPTY_FAVS: Favs = emptyFavs();
const EMPTY_HIST: HistoryEntry[] = [];
export const useFavs = () => useApp((s) => s.favs[s.activeId ?? "_"] ?? EMPTY_FAVS);
export const useHistory = () => useApp((s) => s.history[s.activeId ?? "_"] ?? EMPTY_HIST);

const providers = new Map<string, Provider>();
export function getProvider(p: Profile): Provider {
  const key = JSON.stringify(p);
  let prov = providers.get(key);
  if (!prov) {
    prov = createProvider(p);
    providers.set(key, prov);
  }
  return prov;
}
export function useProvider(): Provider | null {
  const p = useProfile();
  return p ? getProvider(p) : null;
}
export function resetProviders() {
  providers.clear();
}
