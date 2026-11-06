export interface Settings {
  liveFormat: "ts" | "m3u8";
  timeFormat24: boolean;
  autoplayPreview: boolean;
  hideAdult: boolean;
}

export const defaultSettings: Settings = {
  liveFormat: "m3u8",
  timeFormat24: true,
  autoplayPreview: true,
  hideAdult: true,
};

let current: Settings = defaultSettings;
export const setSettingsRef = (s: Settings) => (current = s);
export const getSettings = () => current;

const ADULT = /\b(xxx|adult|adulto|adults|18\+|porn)/i;
export const isAdult = (name: string) => ADULT.test(name);
