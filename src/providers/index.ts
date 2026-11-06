import type { Profile, Provider } from "../lib/types";
import { createDemo } from "./demo";
import { createM3u } from "./m3u";
import { createStalker } from "./stalker";
import { createXtream } from "./xtream";

export function createProvider(p: Profile): Provider {
  switch (p.kind) {
    case "xtream":
      return createXtream(p);
    case "m3u":
      return createM3u(p);
    case "stalker":
      return createStalker(p);
    default:
      return createDemo();
  }
}
