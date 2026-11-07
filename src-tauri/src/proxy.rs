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

pub const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HurricaneTV/0.1 Chrome/130 Safari/537.36";

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

#[derive(Default, Clone)]
pub struct Hdrs {
    pub ua: Option<String>,
    pub referer: Option<String>,
}

fn proxied(target: &str, hd: &Hdrs) -> String {
    let mut s = format!("http://127.0.0.1:{}/p?u={}", port(), urlencode(target));
    if let Some(ua) = &hd.ua {
        s.push_str("&ua=");
        s.push_str(&urlencode(ua));
    }
    if let Some(r) = &hd.referer {
        s.push_str("&ref=");
        s.push_str(&urlencode(r));
    }
    s
}

/// Apply UA / Referer to an outgoing request.
pub fn apply(mut r: reqwest::blocking::RequestBuilder, hd: &Hdrs) -> reqwest::blocking::RequestBuilder {
    r = r.header("User-Agent", hd.ua.as_deref().unwrap_or(DEFAULT_UA));
    if let Some(rf) = &hd.referer {
        r = r.header("Referer", rf.as_str());
    }
    r
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn rewrite_playlist(body: &str, base: &Url, hd: &Hdrs) -> String {
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
                        out.push_str(&proxied(abs.as_str(), hd));
                        out.push_str(&rest[end..]);
                        out.push('\n');
                        continue;
                    }
                }
            }
            out.push_str(t);
        } else if let Ok(abs) = base.join(t) {
            out.push_str(&proxied(abs.as_str(), hd));
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
    let mut hd = Hdrs::default();
    let mut live = false;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "u" => target = Some(v.into_owned()),
            "ua" => hd.ua = Some(v.into_owned()),
            "ref" => hd.referer = Some(v.into_owned()),
            "live" => live = v == "1",
            _ => {}
        }
    }
    let Some(target) = target else { return respond_err(req, 400, "missing u") };

    let mut r = apply(client().get(&target), &hd);
    for h in req.headers() {
        // Keep Range for VOD: the player only allows seeking after a 206 reply to
        // "bytes=0-". For live streams some IPTV servers reject ranged requests.
        if h.field.equiv("Range") && !(live && h.value.as_str().trim() == "bytes=0-") {
            r = r.header("Range", h.value.as_str());
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
            let body = rewrite_playlist(&text, &final_url, &hd);
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

    // Matroska: extract embedded subtitles from the bytes as they stream past
    let is_mkv = status < 400
        && (target.split('?').next().unwrap_or("").to_ascii_lowercase().ends_with(".mkv")
            || final_url.path().to_ascii_lowercase().ends_with(".mkv")
            || ctype.to_ascii_lowercase().contains("matroska")
            || crate::mkv::known(&target));
    if is_mkv {
        let range_start = resp
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim_start_matches("bytes ").split('-').next()?.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let parser = crate::mkv::Parser::new(&target, range_start == 0);
        let tee = crate::mkv::Tee { inner: resp, parser };
        let _ = req.respond(Response::new(StatusCode(status), cors(headers), tee, len, None));
        return;
    }

    let _ = req.respond(Response::new(StatusCode(status), cors(headers), resp, len, None));
}

fn respond_err(req: Request, code: u16, msg: &str) {
    let headers = cors(vec![h("Content-Type", "text/plain").unwrap()]);
    let _ = req.respond(Response::new(StatusCode(code), headers, msg.as_bytes(), Some(msg.len()), None));
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    #[test]
    fn mkv_through_proxy() {
        let Ok(path) = std::env::var("MKV_TEST_FILE") else { return };
        let data = std::sync::Arc::new(std::fs::read(path).unwrap());
        // tiny origin server
        let origin = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let oport = origin.server_addr().to_ip().unwrap().port();
        let d = data.clone();
        std::thread::spawn(move || {
            for req in origin.incoming_requests() {
                let r = tiny_http::Response::from_data(d.to_vec()).with_header(tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"video/x-matroska"[..]).unwrap());
                let _ = req.respond(r);
            }
        });
        super::start();
        let target = format!("http://127.0.0.1:{oport}/movie/1/2/3.mkv");
        let url = format!("http://127.0.0.1:{}/p?u={}", super::port(), super::urlencode(&target));
        let mut body = Vec::new();
        reqwest::blocking::get(&url).unwrap().read_to_end(&mut body).unwrap();
        assert_eq!(body.len(), data.len(), "proxy must pass bytes through untouched");
        assert_eq!(&body[..], &data[..]);
        let t = crate::mkv::tracks(&target);
        assert_eq!(t.len(), 8);
        assert!(!crate::mkv::cues(&target, t[0].number).is_empty());
    }
}

#[cfg(test)]
mod range_tests {
    use std::io::Read;

    fn origin(data: Vec<u8>) -> u16 {
        let srv = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = srv.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || {
            for req in srv.incoming_requests() {
                let range = req.headers().iter().find(|h| h.field.equiv("Range")).map(|h| h.value.as_str().to_string());
                let total = data.len();
                let resp = match range.and_then(|r| {
                    let r = r.trim_start_matches("bytes=");
                    let (a, b) = r.split_once('-')?;
                    let a: usize = a.parse().ok()?;
                    let b: usize = if b.is_empty() { total - 1 } else { b.parse().ok()? };
                    Some((a, b))
                }) {
                    Some((a, b)) => tiny_http::Response::from_data(data[a..=b].to_vec())
                        .with_status_code(206)
                        .with_header(tiny_http::Header::from_bytes(&b"Content-Range"[..], format!("bytes {a}-{b}/{total}").as_bytes()).unwrap())
                        .with_header(tiny_http::Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap()),
                    None => tiny_http::Response::from_data(data.clone()),
                };
                let _ = req.respond(resp);
            }
        });
        port
    }

    fn get(url: &str, range: &str) -> (u16, Vec<u8>, Option<String>) {
        let mut r = reqwest::blocking::Client::new().get(url).header("Range", range).send().unwrap();
        let st = r.status().as_u16();
        let cr = r.headers().get("content-range").map(|v| v.to_str().unwrap().to_string());
        let mut b = Vec::new();
        r.read_to_end(&mut b).unwrap();
        (st, b, cr)
    }

    #[test]
    fn vod_range_is_forwarded() {
        let data: Vec<u8> = (0..50_000u32).map(|i| (i % 251) as u8).collect();
        let op = origin(data.clone());
        super::start();
        let target = format!("http://127.0.0.1:{op}/movie/a/b/1.mp4");
        let base = format!("http://127.0.0.1:{}/p?u={}", super::port(), super::urlencode(&target));

        let (st, body, _) = get(&base, "bytes=0-");
        assert_eq!(st, 206, "VOD bytes=0- must reach origin so the player can seek");
        assert_eq!(body.len(), data.len());

        let (st, body, cr) = get(&base, "bytes=1000-1999");
        assert_eq!(st, 206);
        assert_eq!(cr.as_deref(), Some("bytes 1000-1999/50000"));
        assert_eq!(&body[..], &data[1000..2000]);

        let (st, _, _) = get(&format!("{base}&live=1"), "bytes=0-");
        assert_eq!(st, 200, "live streams drop the open-ended range");
    }
}
