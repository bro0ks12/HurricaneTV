//! On-demand audio (and, if needed, video) conversion so files whose codecs the webview can't
//! decode (E-AC3 / AC3 / DTS audio, HEVC video) still play with sound inside the app.
//!
//! ffmpeg ships with the app as a sidecar (src-tauri/binaries, fetched by scripts/fetch-ffmpeg.mjs and
//! installed next to hurricanetv.exe). Conversion runs it as a child process that reads the original
//! stream through the local proxy and writes a fragmented MP4 to the HTTP response.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};

use serde::Serialize;
use tiny_http::{Header, Request, Response, StatusCode};
use url::Url;

/// The bundled ffmpeg: installed next to the app's own executable (also true for `tauri dev`).
pub fn ffmpeg_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().map(|d| d.join("ffmpeg.exe")).unwrap_or_else(|| PathBuf::from("ffmpeg.exe"))
}

pub fn installed() -> bool {
    ffmpeg_path().is_file()
}

fn command() -> Command {
    let mut c = Command::new(ffmpeg_path());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c.args(["-hide_banner", "-nostdin", "-loglevel", "error"]);
    c
}

/* ---------------- info ---------------- */

#[derive(Serialize, Default)]
pub struct AudioInfo {
    pub index: u32,
    pub codec: String,
    pub lang: String,
}

#[derive(Serialize, Default)]
pub struct TxInfo {
    pub duration: f64,
    pub video: String,
    pub audio: Vec<AudioInfo>,
}

fn parse_duration(line: &str) -> Option<f64> {
    let rest = line.split("Duration:").nth(1)?.trim();
    let t = rest.split(',').next()?.trim();
    let mut parts = t.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Duration and streams of a url (read through the proxy). Needs ffmpeg installed.
pub fn info(proxied_url: &str) -> Result<TxInfo, String> {
    let out = command()
        .args(["-loglevel", "info", "-i", proxied_url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stderr);
    let mut info = TxInfo::default();
    let mut audio_n = 0u32;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with("Duration:") {
            if let Some(d) = parse_duration(l) {
                info.duration = d;
            }
        } else if l.starts_with("Stream #") {
            let lang = l.split('(').nth(1).and_then(|s| s.split(')').next()).filter(|s| s.len() <= 4).unwrap_or("").to_string();
            if let Some(v) = l.split(": Video: ").nth(1) {
                if info.video.is_empty() {
                    info.video = v.split(|c: char| c == ' ' || c == ',' || c == '(').next().unwrap_or("").to_string();
                }
            } else if let Some(a) = l.split(": Audio: ").nth(1) {
                info.audio.push(AudioInfo { index: audio_n, codec: a.split(|c: char| c == ' ' || c == ',' || c == '(').next().unwrap_or("").to_string(), lang });
                audio_n += 1;
            }
        }
    }
    if info.duration <= 0.0 && info.audio.is_empty() && info.video.is_empty() {
        return Err("não foi possível ler o ficheiro".into());
    }
    Ok(info)
}

/* ---------------- stream ---------------- */

/// Stdout of the ffmpeg child; killing the child when the HTTP client goes away.
struct Piped {
    child: Child,
    out: ChildStdout,
}

impl Read for Piped {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.out.read(buf)
    }
}

impl Drop for Piped {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn h(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

/// `/tx?u=<proxied url>&ss=<seconds>&mode=audio|video&a=<audio index>` → fragmented MP4 stream.
pub fn serve(req: Request, q: &Url) {
    let mut src = None;
    let mut ss = 0f64;
    let mut video = false;
    let mut audio = 0u32;
    for (k, v) in q.query_pairs() {
        match k.as_ref() {
            "u" => src = Some(v.into_owned()),
            "ss" => ss = v.parse().unwrap_or(0.0),
            "mode" => video = v == "video",
            "a" => audio = v.parse().unwrap_or(0),
            _ => {}
        }
    }
    let cors = |mut v: Vec<Header>| {
        v.push(h("Access-Control-Allow-Origin", "*"));
        v
    };
    let Some(src) = src else {
        let _ = req.respond(Response::new(StatusCode(400), cors(vec![]), &b"missing u"[..], Some(9), None));
        return;
    };
    // only ever read through our own proxy
    if !src.starts_with(&format!("http://127.0.0.1:{}/", crate::proxy::port())) || !installed() {
        let _ = req.respond(Response::new(StatusCode(400), cors(vec![]), &b"bad request"[..], Some(11), None));
        return;
    }

    let mut c = command();
    if ss > 0.5 {
        // Video is copied, so it can only start on a keyframe. With accurate seeking the audio would be cut at the
        // exact second instead and play late by up to a whole GOP: start both streams from the same keyframe.
        if !video {
            c.arg("-noaccurate_seek");
        }
        c.args(["-ss", &format!("{ss:.3}")]);
    }
    c.args(["-i", &src, "-map", "0:v:0", "-map"]).arg(format!("0:a:{audio}?")).args(["-sn", "-dn"]);
    if video {
        c.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]);
    } else {
        c.args(["-c:v", "copy"]);
    }
    c.args(["-c:a", "aac", "-b:a", "192k", "-ac", "2"]);
    c.args(["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]);
    c.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());

    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            let m = e.to_string();
            let _ = req.respond(Response::new(StatusCode(500), cors(vec![]), m.as_bytes(), Some(m.len()), None));
            return;
        }
    };
    let Some(out) = child.stdout.take() else {
        let _ = child.kill();
        return;
    };
    let body = Piped { child, out };
    let headers = cors(vec![h("Content-Type", "video/mp4"), h("Cache-Control", "no-store")]);
    let _ = req.respond(Response::new(StatusCode(200), headers, body, None, None));
}
