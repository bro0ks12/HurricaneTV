// Fetches the ffmpeg build that ships inside the app (Tauri sidecar) into src-tauri/binaries/.
// Runs before `npm run tauri ...` and in CI. Pinned to one release and verified against the publisher's SHA-256.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "9.0.2";
const BASE = "https://www.gyan.dev/ffmpeg/builds/packages";
const ZIP = `ffmpeg-${VERSION}-essentials_build.zip`;
const TARGET = "x86_64-pc-windows-msvc";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");
const out = join(outDir, `ffmpeg-${TARGET}.exe`);
const licenseOut = join(root, "src-tauri", "binaries", "FFMPEG-LICENSE.txt");

if (process.platform !== "win32") {
  console.log("fetch-ffmpeg: only the Windows build is bundled; skipping on this platform.");
  process.exit(0);
}
if (existsSync(out) && statSync(out).size > 10_000_000) process.exit(0);

console.log(`fetch-ffmpeg: downloading ffmpeg ${VERSION} (one time, ~115 MB)…`);
const get = async (url) => {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};
const expected = (await (await get(`${BASE}/${ZIP}.sha256`)).text()).trim().split(/\s+/)[0].toLowerCase();
if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("fetch-ffmpeg: bad checksum file");

const buf = Buffer.from(await (await get(`${BASE}/${ZIP}`)).arrayBuffer());
const digest = createHash("sha256").update(buf).digest("hex");
if (digest !== expected) throw new Error(`fetch-ffmpeg: SHA-256 mismatch (got ${digest}, expected ${expected})`);

const tmp = mkdtempSync(join(tmpdir(), "htv-ffmpeg-"));
try {
  const zipPath = join(tmp, ZIP);
  writeFileSync(zipPath, buf);
  // bsdtar ships with Windows 10+ and reads .zip
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"); // bsdtar (reads .zip); a GNU tar earlier on PATH cannot
  const x = spawnSync(tar, ["-xf", zipPath, "-C", tmp], { stdio: "inherit" });
  if (x.status !== 0) throw new Error("fetch-ffmpeg: could not extract the archive");
  const dir = readdirSync(tmp).find((d) => d.startsWith("ffmpeg-") && statSync(join(tmp, d)).isDirectory());
  if (!dir) throw new Error("fetch-ffmpeg: unexpected archive layout");
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(tmp, dir, "bin", "ffmpeg.exe"), out);
  if (existsSync(join(tmp, dir, "LICENSE"))) copyFileSync(join(tmp, dir, "LICENSE"), licenseOut);
  console.log(`fetch-ffmpeg: ready → ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
