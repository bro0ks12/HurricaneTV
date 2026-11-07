export type ProviderKind = "xtream" | "m3u" | "stalker" | "demo";

export interface Profile {
  id: string;
  name: string;
  kind: ProviderKind;
  // xtream
  server?: string;
  username?: string;
  password?: string;
  // m3u
  url?: string;
  epgUrl?: string;
  // stalker
  portal?: string;
  mac?: string;
  createdAt: number;
}

export interface Category {
  id: string;
  name: string;
  count?: number;
}

export interface Channel {
  id: string;
  num?: number;
  name: string;
  logo?: string;
  categoryId?: string;
  epgId?: string;
  catchup?: boolean;
  catchupDays?: number;
  isRadio?: boolean;
  ua?: string;
  referer?: string;
  /** direct stream url (xtream / m3u) or stalker cmd */
  stream: string;
}

export interface VodItem {
  id: string;
  name: string;
  poster?: string;
  categoryId?: string;
  rating?: number;
  year?: string;
  ext?: string;
  stream: string;
  ua?: string;
  referer?: string;
}

export interface VodInfo {
  plot?: string;
  genre?: string;
  cast?: string;
  director?: string;
  duration?: string;
  backdrop?: string;
  trailer?: string;
  releaseDate?: string;
}

export interface SeriesItem {
  id: string;
  name: string;
  poster?: string;
  categoryId?: string;
  rating?: number;
  year?: string;
  plot?: string;
}

export interface Episode {
  id: string;
  num: number;
  season: number;
  title: string;
  plot?: string;
  image?: string;
  duration?: string;
  stream: string;
  ua?: string;
  referer?: string;
}

export interface SeriesInfo {
  plot?: string;
  genre?: string;
  cast?: string;
  backdrop?: string;
  seasons: { num: number; name: string; episodes: Episode[] }[];
}

export interface Program {
  title: string;
  description?: string;
  start: number; // epoch ms
  end: number;
  hasArchive?: boolean;
  /** server-local start string (Xtream timeshift) */
  startRaw?: string;
}

export interface AccountInfo {
  status?: string;
  expires?: number | null;
  maxConnections?: number;
  activeConnections?: number;
  createdAt?: number;
  isTrial?: boolean;
  serverUrl?: string;
  timezone?: string;
  extra?: Record<string, string>;
}

export interface Provider {
  kind: ProviderKind;
  account(): Promise<AccountInfo>;
  liveCategories(): Promise<Category[]>;
  liveChannels(categoryId?: string): Promise<Channel[]>;
  vodCategories(): Promise<Category[]>;
  vodItems(categoryId?: string): Promise<VodItem[]>;
  vodInfo(item: VodItem): Promise<VodInfo>;
  seriesCategories(): Promise<Category[]>;
  seriesItems(categoryId?: string): Promise<SeriesItem[]>;
  seriesInfo(item: SeriesItem): Promise<SeriesInfo>;
  epg(channel: Channel, limit?: number): Promise<Program[]>;
  /** Past programmes for catch-up, if supported */
  archive?(channel: Channel): Promise<Program[]>;
  catchupUrl?(channel: Channel, program: Program): Promise<string>;
  /** Resolve the final playable url (Stalker needs a create_link round trip) */
  resolve(stream: string, type: "live" | "vod" | "episode"): Promise<string>;
}
