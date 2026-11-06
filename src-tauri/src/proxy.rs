//! Tiny local HTTP proxy so hls.js / mpegts.js can read IPTV streams that
//! don't send CORS headers. Also rewrites HLS playlists so every segment,
//! key and sub-playlist goes through the proxy too, and forwards `Range`
//! so VOD seeking works.

use std::io::Read;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use url::Url;

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) NexoTV/0.1 Chrome/130 Safari/537.36";

static PORT: OnceLock<u16> = OnceLock::new();
static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

pub fn client() -> &'static reqwest::blocking::Client {
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(None::<Duration>)
            .redirect(reqwest::redirect::Policy::limited(10))
            .danger_accept_invalid_certs(true)
            .build()
            .expect("http client")
    })
}

pub fn port() -> u16 {
    *PORT.get().unwrap_or(&0)
}

pub fn start() {
    let server = Server::http("127.0.0.1:0").expect("proxy bind");
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let _ = PORT.set(port);
    thread::spawn(move || {
        for req in server.incoming_requests() {
            thread::spawn(move || handle(req));
        }
    });
}

fn h(k: &str, v: &str) -> Option<Header> {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).ok()
}

fn cors(mut headers: Vec<Header>) -> Vec<Header> {
    headers.extend(
        [
            h("Access-Control-Allow-Origin", "*"),
            h("Access-Control-Allow-Headers", "*"),
            h("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
            h("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Type"),
        ]
        .into_iter()
        .flatten(),
    );
    headers
}

fn proxied(target: &str, ua: Option<&str>) -> String {
    let mut s = format!("http://127.0.0.1:{}/p?u={}", port(), urlencode(target));
    if let Some(ua) = ua {
        s.push_str("&ua=");
        s.push_str(&urlencode(ua));
    }
    s
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn rewrite_playlist(body: &str, base: &Url, ua: Option<&str>) -> String {
    let mut out = String::with_capacity(body.len() + 1024);
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            out.push('\n');
            continue;
        }
        if t.starts_with('#') {
            // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, ...)
            if let Some(start) = t.find("URI=\"") {
                let rest = &t[start + 5..];
                if let Some(end) = rest.find('"') {
                    let uri = &rest[..end];
                    if let Ok(abs) = base.join(uri) {
                        out.push_str(&t[..start + 5]);
                        out.push_str(&proxied(abs.as_str(), ua));
                        out.push_str(&rest[end..]);
                        out.push('\n');
                        continue;
                    }
                }
            }
            out.push_str(t);
        } else if let Ok(abs) = base.join(t) {
            out.push_str(&proxied(abs.as_str(), ua));
        } else {
            out.push_str(t);
        }
        out.push('\n');
    }
    out
}

fn handle(req: Request) {
    if *req.method() == Method::Options {
        let _ = req.respond(Response::empty(204).with_header(h("Access-Control-Allow-Origin", "*").unwrap()));
        return;
    }
    let full = format!("http://localhost{}", req.url());
    let parsed = match Url::parse(&full) {
        Ok(u) => u,
        Err(_) => return respond_err(req, 400, "bad url"),
    };
    let mut target = None;
    let mut ua = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "u" => target = Some(v.into_owned()),
            "ua" => ua = Some(v.into_owned()),
            _ => {}
        }
    }
    let Some(target) = target else { return respond_err(req, 400, "missing u") };

    let mut r = client().get(&target).header("User-Agent", ua.as_deref().unwrap_or(DEFAULT_UA));
    for hd in req.headers() {
        if hd.field.equiv("Range") {
            r = r.header("Range", hd.value.as_str());
        }
    }
    let resp = match r.send() {
        Ok(r) => r,
        Err(e) => return respond_err(req, 502, &e.to_string()),
    };

    let status = resp.status().as_u16();
    let final_url = resp.url().clone();
    let ctype = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let is_playlist = ctype.to_ascii_lowercase().contains("mpegurl")
        || final_url.path().to_ascii_lowercase().ends_with(".m3u8")
        || target.to_ascii_lowercase().contains(".m3u8");

    if is_playlist && status < 400 {
        let mut resp = resp;
        let mut buf = Vec::new();
        if resp.read_to_end(&mut buf).is_err() {
            return respond_err(req, 502, "read error");
        }
        let text = String::from_utf8_lossy(&buf);
        if text.trim_start().starts_with("#EXTM3U") {
            let body = rewrite_playlist(&text, &final_url, ua.as_deref());
            let headers = cors(vec![h("Content-Type", "application/vnd.apple.mpegurl").unwrap(), h("Cache-Control", "no-cache").unwrap()]);
            let _ = req.respond(Response::new(StatusCode(status), headers, body.as_bytes(), Some(body.len()), None));
        } else {
            let headers = cors(vec![h("Content-Type", &ctype).unwrap_or_else(|| h("Content-Type", "application/octet-stream").unwrap())]);
            let _ = req.respond(Response::new(StatusCode(status), headers, &buf[..], Some(buf.len()), None));
        }
        return;
    }

    let mut headers = Vec::new();
    for name in ["content-type", "content-range", "accept-ranges"] {
        if let Some(v) = resp.headers().get(name).and_then(|v| v.to_str().ok()) {
            if let Some(hd) = h(name, v) {
                headers.push(hd);
            }
        }
    }
    let len = resp.content_length().map(|l| l as usize);
    let _ = req.respond(Response::new(StatusCode(status), cors(headers), resp, len, None));
}

fn respond_err(req: Request, code: u16, msg: &str) {
    let headers = cors(vec![h("Content-Type", "text/plain").unwrap()]);
    let _ = req.respond(Response::new(StatusCode(code), headers, msg.as_bytes(), Some(msg.len()), None));
}
