//! On-demand audio (and, if needed, video) conversion so files whose codecs the webview can't
//! decode (E-AC3 / AC3 / DTS audio, HEVC video) still play with sound inside the app.
//!
//! ffmpeg ships with the app as a sidecar (src-tauri/binaries, fetched by scripts/fetch-ffmpeg.mjs and
//! installed next to hurricanetv.exe). Conversion runs it as a child process that reads the original
//! stream through the local proxy and writes a fragmented MP4 to the HTTP response.

use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

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
//
// ffmpeg's output goes to a temp file that the HTTP responses read from. The webview may drop the connection and
// re-ask (with a Range header) for bytes it already had; reading from a file lets us answer that from the same
// running conversion instead of restarting it from the beginning.

use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// How far ffmpeg may run ahead of what the player has read.
const AHEAD: u64 = 256 * 1024 * 1024;

struct Session {
    key: String,
    path: PathBuf,
    state: Mutex<(u64, bool)>, // bytes written, finished
    cv: Condvar,
    consumed: AtomicU64,
    readers: AtomicUsize,
    dead: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl Session {
    fn stop(&self) {
        self.dead.store(true, Ordering::SeqCst);
        if let Some(c) = self.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
        self.cv.notify_all();
    }
}

static CURRENT: Mutex<Option<Arc<Session>>> = Mutex::new(None);
static COUNTER: AtomicU64 = AtomicU64::new(0);

struct FileReader {
    s: Arc<Session>,
    file: File,
    pos: u64,
}

impl Read for FileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let (written, done) = *self.s.state.lock().unwrap();
            if self.pos < written {
                let n = ((written - self.pos) as usize).min(buf.len());
                self.file.seek(SeekFrom::Start(self.pos))?;
                let n = self.file.read(&mut buf[..n])?;
                self.pos += n as u64;
                self.s.consumed.fetch_max(self.pos, Ordering::SeqCst);
                self.s.cv.notify_all();
                return Ok(n);
            }
            if done || self.s.dead.load(Ordering::SeqCst) {
                return Ok(0);
            }
            let g = self.s.state.lock().unwrap();
            let _ = self.s.cv.wait_timeout(g, Duration::from_millis(500));
        }
    }
}

impl Drop for FileReader {
    fn drop(&mut self) {
        // nobody reading for a while (player closed, or switched title) -> stop converting and clean up
        if self.s.readers.fetch_sub(1, Ordering::SeqCst) == 1 {
            let s = self.s.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(20));
                if s.readers.load(Ordering::SeqCst) == 0 {
                    s.stop();
                    let _ = std::fs::remove_file(&s.path);
                    let mut cur = CURRENT.lock().unwrap();
                    if cur.as_ref().map(|c| Arc::ptr_eq(c, &s)).unwrap_or(false) {
                        *cur = None;
                    }
                }
            });
        }
    }
}

fn h(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

fn start(src: &str, ss: f64, video: bool, audio: u32, key: String) -> Result<Arc<Session>, String> {
    let mut c = command();
    if ss > 0.5 {
        // Video is copied, so it can only start on a keyframe. With accurate seeking the audio would be cut at the
        // exact second instead and play late by up to a whole GOP: start both streams from the same keyframe.
        if !video {
            c.arg("-noaccurate_seek");
        }
        c.args(["-ss", &format!("{ss:.3}")]);
    }
    c.args(["-i", src, "-map", "0:v:0", "-map"]).arg(format!("0:a:{audio}?")).args(["-sn", "-dn"]);
    if video {
        c.args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]);
    } else {
        c.args(["-c:v", "copy"]);
    }
    c.args(["-c:a", "aac", "-b:a", "192k", "-ac", "2"]);
    c.args(["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1"]);
    let log = File::create(std::env::temp_dir().join("hurricanetv-ffmpeg.log")).ok();
    c.stdin(Stdio::null()).stdout(Stdio::piped());
    match log {
        Some(f) => c.stderr(Stdio::from(f)),
        None => c.stderr(Stdio::null()),
    };
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    let mut out = child.stdout.take().ok_or("no output")?;
    let path = std::env::temp_dir().join(format!("hurricanetv-tx-{}-{}.mp4", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
    let mut file = File::create(&path).map_err(|e| e.to_string())?;
    let s = Arc::new(Session {
        key,
        path,
        state: Mutex::new((0, false)),
        cv: Condvar::new(),
        consumed: AtomicU64::new(0),
        readers: AtomicUsize::new(0),
        dead: AtomicBool::new(false),
        child: Mutex::new(Some(child)),
    });
    let w = s.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            // don't run unboundedly ahead of the player
            while !w.dead.load(Ordering::SeqCst) && w.state.lock().unwrap().0 > w.consumed.load(Ordering::SeqCst) + AHEAD {
                let g = w.state.lock().unwrap();
                let _ = w.cv.wait_timeout(g, Duration::from_millis(500));
            }
            if w.dead.load(Ordering::SeqCst) {
                break;
            }
            match out.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if file.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    w.state.lock().unwrap().0 += n as u64;
                    w.cv.notify_all();
                }
            }
        }
        w.state.lock().unwrap().1 = true;
        w.cv.notify_all();
        if let Some(mut c) = w.child.lock().unwrap().take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    });
    Ok(s)
}

/// `/tx?u=<proxied url>&ss=<seconds>&mode=audio|video&a=<audio index>` -> fragmented MP4 stream.
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

    let key = format!("{src}|{ss:.3}|{video}|{audio}");
    let session = {
        let mut cur = CURRENT.lock().unwrap();
        match cur.as_ref() {
            Some(s) if s.key == key && !s.dead.load(Ordering::SeqCst) => s.clone(),
            _ => {
                if let Some(old) = cur.take() {
                    old.stop();
                    let _ = std::fs::remove_file(&old.path);
                }
                match start(&src, ss, video, audio, key) {
                    Ok(s) => {
                        *cur = Some(s.clone());
                        s
                    }
                    Err(m) => {
                        let _ = req.respond(Response::new(StatusCode(500), cors(vec![]), m.as_bytes(), Some(m.len()), None));
                        return;
                    }
                }
            }
        }
    };

    // a re-request for bytes the webview already had (Range: bytes=N-)
    let from = req
        .headers()
        .iter()
        .find(|x| x.field.equiv("Range"))
        .and_then(|x| x.value.as_str().strip_prefix("bytes=").map(|s| s.to_string()))
        .and_then(|s| s.split('-').next().and_then(|n| n.parse::<u64>().ok()))
        .unwrap_or(0);

    let Ok(file) = File::open(&session.path) else {
        let _ = req.respond(Response::new(StatusCode(500), cors(vec![]), &b"gone"[..], Some(4), None));
        return;
    };
    session.readers.fetch_add(1, Ordering::SeqCst);
    let body = FileReader { s: session, file, pos: from };
    let mut headers = cors(vec![h("Content-Type", "video/mp4"), h("Cache-Control", "no-store"), h("Accept-Ranges", "bytes")]);
    let status = if from > 0 {
        headers.push(h("Content-Range", &format!("bytes {from}-{}/{}", (1u64 << 40) - 2, 1u64 << 40)));
        206
    } else {
        200
    };
    let _ = req.respond(Response::new(StatusCode(status), headers, body, None, None));
}
