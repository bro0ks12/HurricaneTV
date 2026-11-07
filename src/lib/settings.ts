export interface Settings {
  liveFormat: "ts" | "m3u8";
  timeFormat24: boolean;
  autoplayPreview: boolean;
  hideAdult: boolean;
  /** subtitle font size in % of default */
  subSize: number;
  subBackground: boolean;
  /** ISO code to auto-select, "" = off */
  subLang: string;
  /** optional path to VLC / mpv; empty = auto-detect */
  externalPlayer: string;
  /** fetch posters, synopsis, IMDb rating and cast online */
  metadata: boolean;
  /** optional TMDB key (v3 key or v4 read token) for Portuguese synopses + cast photos */
  tmdbKey: string;
  /** SHA-256 of the parental PIN; "" = parental control off */
  parentalPinHash: string;
  /** adult categories always need the PIN (instead of only being hidden) */
  parentalLockAdult: boolean;
  /** interface language */
  language: "pt" | "en" | "es" | "fr" | "de" | "it";
}

export const defaultSettings: Settings = {
  liveFormat: "m3u8",
  timeFormat24: true,
  autoplayPreview: true,
  hideAdult: true,
  subSize: 100,
  subBackground: true,
  subLang: "",
  externalPlayer: "",
  metadata: true,
  tmdbKey: "",
  parentalPinHash: "",
  parentalLockAdult: true,
  language: "pt",
};

let current: Settings = defaultSettings;
export const setSettingsRef = (s: Settings) => (current = s);
export const getSettings = () => current;

const ADULT = /\b(xxx|adult|adulto|adults|18\+|porn)/i;
export const isAdult = (name: string) => ADULT.test(name);
