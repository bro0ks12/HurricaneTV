mod proxy;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    proxy::start();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![http_get, proxy_port])
        .run(tauri::generate_context!())
        .expect("error while running NexoTV");
}
