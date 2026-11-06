# NexoTV

Leitor IPTV desktop (Tauri 2 + React 19 + Tailwind 4) com interface estilo TV.

Fontes suportadas: **Xtream Codes API**, **Playlist M3U/M3U8** (+ EPG XMLTV), **Stalker/MAC portal** e um perfil **Demonstração**.

## Correr

```bash
npm install
npm run tauri dev      # app desktop
npm run dev            # só a UI no browser (http://localhost:1430) — sujeito a CORS, usar perfil Demo
npm run tauri build    # instalador
```

## Arquitetura

- `src-tauri/src/proxy.rs` — proxy HTTP local (127.0.0.1:porta aleatória) para os streams: adiciona CORS, encaminha `Range` (seek em VOD) e reescreve playlists HLS.
- `src-tauri/src/lib.rs` — comando `http_get` (pedidos de API sem CORS, descompacta `.xml.gz`).
- `src/providers/*` — `xtream.ts`, `m3u.ts`, `stalker.ts`, `demo.ts` implementam a interface `Provider` (`src/lib/types.ts`).
- `src/components/VideoSurface.tsx` — escolhe hls.js / mpegts.js / nativo conforme o URL.
- `src/lib/spatial.ts` — navegação por setas (comando/teclado).

Atalhos: setas navegam · Enter abre · Esc/Backspace volta · no leitor: Espaço, F (ecrã inteiro), M (som), ↑/↓ zapping, números para ir a um canal.
