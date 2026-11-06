import type { Category, Channel, Program, Provider, SeriesItem, VodItem } from "../lib/types";

/** Offline demo source using public test streams — handy to explore the UI without a subscription. */

const HLS = [
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
  "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8",
];
const MP4 = [
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
  "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8",
  "https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4",
];

const liveCats: Category[] = [
  { id: "news", name: "Notícias" },
  { id: "sports", name: "Desporto" },
  { id: "movies", name: "Cinema" },
  { id: "kids", name: "Infantil" },
  { id: "docs", name: "Documentários" },
  { id: "radio", name: "Rádio" },
];
const names: Record<string, string[]> = {
  news: ["Atlas News", "Global 24", "Meridian Info", "Pulse Now", "Daily Wire PT"],
  sports: ["Arena Sport 1", "Arena Sport 2", "Goal TV", "Racing+ ", "Court Live"],
  movies: ["Cine Prime", "Cine Action", "Cine Classic", "Noir HD"],
  kids: ["Kiddo", "Toon Planet", "Little Stars"],
  docs: ["Terra Doc", "History Lane", "Ocean Deep", "Cosmos HD"],
  radio: ["Rádio Onda", "Lounge FM", "Rock Station"],
};
const shows = ["Jornal da Noite", "Grande Reportagem", "Directo", "Magazine", "Resumo do Dia", "Entrevista", "Análise", "Especial", "Debate", "Bastidores", "Em Foco", "Ao Vivo"];

const channels: Channel[] = [];
let n = 1;
for (const c of liveCats) {
  for (const name of names[c.id]) {
    channels.push({
      id: `ch${n}`,
      num: n,
      name: name.trim(),
      categoryId: c.id,
      catchup: c.id === "news" || c.id === "sports",
      catchupDays: 3,
      isRadio: c.id === "radio",
      stream: HLS[n % HLS.length],
    });
    n++;
  }
}

function seedRand(seed: number) {
  let s = seed;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function programs(ch: Channel, from: number, to: number): Program[] {
  const rnd = seedRand(Number(ch.id.slice(2)) * 97);
  const out: Program[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  let t = day.getTime() - 864e5;
  while (t < to) {
    const dur = [30, 45, 60, 90, 120][Math.floor(rnd() * 5)] * 60000;
    if (t + dur > from) {
      const title = shows[Math.floor(rnd() * shows.length)];
      out.push({ title: `${title}`, description: `${title} em ${ch.name}. Programa de demonstração gerado automaticamente.`, start: t, end: t + dur, hasArchive: ch.catchup });
    }
    t += dur;
  }
  return out;
}

const vodCats: Category[] = [
  { id: "action", name: "Ação" },
  { id: "drama", name: "Drama" },
  { id: "anim", name: "Animação" },
  { id: "scifi", name: "Ficção Científica" },
];
const movieTitles = [
  "O Último Horizonte", "Cidade de Vidro", "Rota 66", "Eclipse Total", "Maré Alta", "O Arquivista", "Sombras de Lisboa",
  "Ponto Zero", "Céu Vermelho", "A Fronteira", "Nevoeiro", "Fragmentos", "Linha de Fogo", "Órbita", "O Relojoeiro",
  "Faróis", "Terra Prometida", "Velocidade Máxima", "Neon", "O Silêncio",
];
const vod: VodItem[] = movieTitles.map((name, i) => ({
  id: `m${i}`,
  name,
  categoryId: vodCats[i % vodCats.length].id,
  rating: Math.round((5 + ((i * 37) % 45) / 10) * 10) / 10,
  year: String(2010 + ((i * 7) % 15)),
  stream: MP4[i % MP4.length],
}));

const seriesTitles = ["Os Navegadores", "Distrito 9", "Código Azul", "Herança", "Atlântida", "Turno da Noite", "Marés", "A Casa"];
const series: SeriesItem[] = seriesTitles.map((name, i) => ({
  id: `s${i}`,
  name,
  categoryId: vodCats[i % vodCats.length].id,
  rating: Math.round((6 + ((i * 29) % 35) / 10) * 10) / 10,
  year: String(2015 + (i % 9)),
  plot: `${name} é uma série de demonstração. Cada episódio aponta para um vídeo de teste público.`,
}));

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120));

export function createDemo(): Provider {
  return {
    kind: "demo",
    account: () => wait({ status: "Active", expires: Date.now() + 365 * 864e5, maxConnections: 2, activeConnections: 0, serverUrl: "demo://nexotv", isTrial: true }),
    liveCategories: () => wait(liveCats),
    liveChannels: (cat) => wait(channels.filter((c) => !cat || c.categoryId === cat)),
    vodCategories: () => wait(vodCats),
    vodItems: (cat) => wait(vod.filter((c) => !cat || c.categoryId === cat)),
    vodInfo: (item) =>
      wait({
        plot: `${item.name} — um filme de demonstração. O vídeo é um stream de teste público.`,
        genre: vodCats.find((c) => c.id === item.categoryId)?.name,
        cast: "Ana Ribeiro, João Matos, Sofia Lima",
        director: "M. Duarte",
        duration: "1h 42m",
      }),
    seriesCategories: () => wait(vodCats),
    seriesItems: (cat) => wait(series.filter((c) => !cat || c.categoryId === cat)),
    seriesInfo: (item) =>
      wait({
        plot: item.plot,
        genre: vodCats.find((c) => c.id === item.categoryId)?.name,
        seasons: [1, 2, 3].map((sn) => ({
          num: sn,
          name: `Temporada ${sn}`,
          episodes: Array.from({ length: 8 }, (_, i) => ({
            id: `${item.id}-${sn}-${i + 1}`,
            num: i + 1,
            season: sn,
            title: `Episódio ${i + 1}`,
            plot: "Descrição do episódio de demonstração.",
            duration: "45m",
            stream: MP4[(i + sn) % MP4.length],
          })),
        })),
      }),
    epg: (ch, limit = 8) => {
      const now = Date.now();
      return wait(programs(ch, now - 6 * 36e5, now + 24 * 36e5).filter((p) => p.end > now).slice(0, limit));
    },
    archive: (ch) => {
      const now = Date.now();
      return wait(programs(ch, now - 3 * 864e5, now).filter((p) => p.end < now).reverse());
    },
    catchupUrl: async () => MP4[0],
    resolve: async (s) => s,
  };
}

/** Wider EPG window (used by the guide grid) */
export function demoPrograms(ch: Channel, from: number, to: number) {
  return programs(ch, from, to);
}
