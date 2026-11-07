mod mkv;
mod proxy;

/// Subtitle tracks found so far in an MKV streamed through the proxy.
#[tauri::command]
fn mkv_tracks(url: String) -> Vec<mkv::SubTrack> {
    mkv::tracks(&url)
}

/// Cues collected so far for one MKV subtitle track (grows as playback buffers).
#[tauri::command]
fn mkv_cues(url: String, track: u64) -> Vec<mkv::CueOut> {
    mkv::cues(&url, track)
}

use std::collections::HashMap;
use std::io::Read;

use serde::Serialize;

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

/// Generic HTTP GET used by the providers (Xtream / M3U / Stalker / XMLTV).
/// Runs in Rust so it is not subject to the webview's CORS rules.
#[tauri::command]
async fn http_get(url: String, headers: Option<HashMap<String, String>>) -> Result<HttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = proxy::client();
        let mut req = client.get(&url);
        let mut has_ua = false;
        if let Some(h) = headers {
            for (k, v) in h {
                if k.eq_ignore_ascii_case("user-agent") {
                    has_ua = true;
                }
                req = req.header(k, v);
            }
        }
        if !has_ua {
            req = req.header("User-Agent", proxy::DEFAULT_UA);
        }
        let resp = req.send().map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let mut out_headers = HashMap::new();
        for (k, v) in resp.headers() {
            if let Ok(s) = v.to_str() {
                out_headers.insert(k.as_str().to_string(), s.to_string());
            }
        }
        let bytes = resp.bytes().map_err(|e| e.to_string())?;
        // XMLTV files are frequently served as raw .gz
        let body = if bytes.len() > 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
            let mut d = flate2::read::GzDecoder::new(&bytes[..]);
            let mut s = String::new();
            d.read_to_string(&mut s).map_err(|e| e.to_string())?;
            s
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        };
        Ok(HttpResponse { status, body, headers: out_headers })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn proxy_port() -> u16 {
    proxy::port()
}

/// Write a text file (backups) into the user's Downloads folder; returns the full path.
#[tauri::command]
fn save_to_downloads(app: tauri::AppHandle, filename: String, contents: String) -> Result<String, String> {
    use tauri::Manager;
    let safe: String = filename.chars().map(|c| if r#"\/:*?"<>|"#.contains(c) { '_' } else { c }).collect();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Show a file in Explorer / Finder.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").args(["-R", &path]).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/"))).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct Probe {
    /// "hls" | "ts" | "mp4" | "mkv" | "other"
    kind: String,
    status: u16,
    content_type: String,
}

/// Peek at the first bytes of a stream to decide which player engine to use
/// (extension-less IPTV urls can be HLS, MPEG-TS or a redirect to either).
#[tauri::command]
async fn probe_stream(url: String, ua: Option<String>, referer: Option<String>) -> Result<Probe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hd = proxy::Hdrs { ua, referer };
        let mut resp = proxy::apply(proxy::client().get(&url), &hd)
            .timeout(std::time::Duration::from_secs(12))
            .send()
            .map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let ct = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut buf = [0u8; 1024];
        let mut n = 0;
        while n < buf.len() {
            match resp.read(&mut buf[n..]) {
                Ok(0) => break,
                Ok(k) => n += k,
                Err(_) => break,
            }
        }
        drop(resp); // close quickly: many IPTV accounts allow a single connection
        let head = &buf[..n];
        let text = String::from_utf8_lossy(head);
        let kind = if text.trim_start().starts_with("#EXTM3U") || ct.contains("mpegurl") {
            "hls"
        } else if head.first() == Some(&0x47) || ct.contains("mp2t") {
            "ts"
        } else if head.len() > 8 && &head[4..8] == b"ftyp" {
            "mp4"
        } else if head.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
            "mkv"
        } else {
            "other"
        };
        Ok(Probe { kind: kind.into(), status, content_type: ct })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn find_player(custom: Option<String>) -> Option<std::path::PathBuf> {
    if let Some(c) = custom.filter(|c| !c.trim().is_empty()) {
        return Some(c.trim().trim_matches('"').into());
    }
    let mut candidates: Vec<std::path::PathBuf> = vec![
        r"C:\Program Files\VideoLAN\VLC\vlc.exe".into(),
        r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe".into(),
        r"C:\Program Files\mpv\mpv.exe".into(),
        "/Applications/VLC.app/Contents/MacOS/VLC".into(),
        "/usr/bin/vlc".into(),
        "/usr/bin/mpv".into(),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(std::path::Path::new(&local).join("Programs").join("mpv").join("mpv.exe"));
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            for exe in ["mpv.exe", "vlc.exe", "mpv", "vlc"] {
                candidates.push(dir.join(exe));
            }
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Open a stream in VLC / mpv — fallback for codecs the webview can't decode
/// (HEVC, AC-3, MP2 audio, MKV subtitles...).
#[tauri::command]
fn open_external(url: String, title: Option<String>, ua: Option<String>, referer: Option<String>, player: Option<String>) -> Result<String, String> {
    let exe = find_player(player).ok_or("Não encontrei o VLC nem o mpv. Instala o VLC ou indica o caminho nas Definições.")?;
    let name = exe.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut cmd = std::process::Command::new(&exe);
    if name.contains("mpv") {
        if let Some(ua) = &ua {
            cmd.arg(format!("--user-agent={ua}"));
        }
        if let Some(r) = &referer {
            cmd.arg(format!("--referrer={r}"));
        }
        if let Some(t) = &title {
            cmd.arg(format!("--force-media-title={t}"));
        }
    } else {
        if let Some(ua) = &ua {
            cmd.arg(format!("--http-user-agent={ua}"));
        }
        if let Some(r) = &referer {
            cmd.arg(format!("--http-referrer={r}"));
        }
        if let Some(t) = &title {
            cmd.arg(format!("--meta-title={t}"));
        }
    }
    cmd.arg(&url);
    cmd.spawn().map_err(|e| format!("Falha ao abrir {}: {e}", exe.display()))?;
    Ok(exe.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    proxy::start();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![http_get, proxy_port, probe_stream, open_external, mkv_tracks, mkv_cues, save_to_downloads, reveal_path])
        .run(tauri::generate_context!())
        .expect("error while running HurricaneTV");
}
