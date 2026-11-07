//! Streaming Matroska subtitle extractor.
//!
//! The webview can play MKV but ignores embedded subtitle tracks. Every byte
//! of the video already flows through our local proxy, so we parse the EBML
//! stream on the fly (like VLC does): track headers come from the start of
//! the file, subtitle blocks are collected from each cluster as playback /
//! buffering reaches it. Video and audio blocks are skipped without copying.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

const ID_EBML: u32 = 0x1A45DFA3;
const ID_SEGMENT: u32 = 0x18538067;
const ID_INFO: u32 = 0x1549A966;
const ID_TIMECODE_SCALE: u32 = 0x2AD7B1;
const ID_TRACKS: u32 = 0x1654AE6B;
const ID_TRACK_ENTRY: u32 = 0xAE;
const ID_TRACK_NUMBER: u32 = 0xD7;
const ID_TRACK_TYPE: u32 = 0x83;
const ID_CODEC_ID: u32 = 0x86;
const ID_LANGUAGE: u32 = 0x22B59C;
const ID_LANGUAGE_BCP47: u32 = 0x22B59D;
const ID_NAME: u32 = 0x536E;
const ID_FLAG_DEFAULT: u32 = 0x88;
const ID_FLAG_FORCED: u32 = 0x55AA;
const ID_CONTENT_ENCODINGS: u32 = 0x6D80;
const ID_CONTENT_ENCODING: u32 = 0x6240;
const ID_CONTENT_COMPRESSION: u32 = 0x5034;
const ID_COMP_ALGO: u32 = 0x4254;
const ID_COMP_SETTINGS: u32 = 0x4255;
const ID_CLUSTER: u32 = 0x1F43B675;
const ID_CLUSTER_TIMECODE: u32 = 0xE7;
const ID_BLOCK_GROUP: u32 = 0xA0;
const ID_BLOCK: u32 = 0xA1;
const ID_SIMPLE_BLOCK: u32 = 0xA3;
const ID_BLOCK_DURATION: u32 = 0x9B;
// other level-1 elements: when we see one, the Tracks section is over
const LEVEL1: [u32; 6] = [0x114D9B74, 0x1C53BB6B, 0x1254C367, 0x1043A770, 0x1941A469, ID_CLUSTER];

const MAX_LEAF: u64 = 1 << 20;
/// no real video/audio frame is bigger than this; a larger "size" means we are parsing garbage
const MAX_BLOCK: u64 = 1 << 27;
/// same idea for other skipped elements (Cues, Tags, attachments...)
const MAX_SKIP: u64 = 1 << 34;

#[derive(Clone, Default, Serialize)]
pub struct SubTrack {
    pub number: u64,
    pub codec: String,
    pub lang: String,
    pub name: String,
    pub default: bool,
    pub forced: bool,
    /// text-based (S_TEXT/*) and therefore renderable; PGS / VobSub are images
    pub text: bool,
    #[serde(skip)]
    comp_algo: Option<u64>,
    #[serde(skip)]
    comp_settings: Vec<u8>,
    #[serde(skip)]
    track_type: u64,
}

#[derive(Clone, Serialize)]
pub struct CueOut {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

struct StoredCue {
    end_ms: Option<i64>,
    text: String,
}

#[derive(Clone, Serialize)]
pub struct CuesOut {
    /// bumps whenever any cue is added or changed, so the UI can skip unchanged polls
    pub ver: u64,
    pub cues: Vec<CueOut>,
}

#[derive(Default)]
pub struct MkvState {
    tracks: Vec<SubTrack>,
    scale: u64,
    cues: HashMap<u64, BTreeMap<i64, StoredCue>>,
    ver: u64,
}

impl MkvState {
    fn new() -> Self {
        MkvState { scale: 1_000_000, ..Default::default() }
    }
}

type Shared = Arc<Mutex<MkvState>>;

/// url -> (state, last-used tick)
type Registry = HashMap<String, (Shared, u64)>;

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

static TICK: AtomicU64 = AtomicU64::new(0);
fn tick() -> u64 {
    TICK.fetch_add(1, Ordering::Relaxed)
}

pub fn known(url: &str) -> bool {
    registry().lock().unwrap().contains_key(url)
}

fn state_for(url: &str) -> Shared {
    let mut r = registry().lock().unwrap();
    if !r.contains_key(url) && r.len() >= 8 {
        // keep memory bounded: drop the least recently used title, never the one playing
        if let Some(old) = r.iter().min_by_key(|(_, (_, t))| *t).map(|(k, _)| k.clone()) {
            r.remove(&old);
        }
    }
    let e = r.entry(url.to_string()).or_insert_with(|| (Arc::new(Mutex::new(MkvState::new())), 0));
    e.1 = tick();
    e.0.clone()
}

pub fn tracks(url: &str) -> Vec<SubTrack> {
    let mut r = registry().lock().unwrap();
    r.get_mut(url)
        .map(|e| {
            e.1 = tick();
            e.0.lock().unwrap().tracks.clone()
        })
        .unwrap_or_default()
}

fn build_cues(s: &MkvState, track: u64) -> Vec<CueOut> {
    let Some(map) = s.cues.get(&track) else { return vec![] };
    let items: Vec<(&i64, &StoredCue)> = map.iter().collect();
    items
        .iter()
        .enumerate()
        .map(|(i, (start, c))| {
            let next = items.get(i + 1).map(|(s, _)| **s);
            let end = c.end_ms.unwrap_or_else(|| {
                let fallback = **start + 4000;
                next.map(|n| n.min(fallback)).unwrap_or(fallback)
            });
            CueOut { start: **start as f64 / 1000.0, end: end as f64 / 1000.0, text: c.text.clone() }
        })
        .collect()
}

#[allow(dead_code)]
pub fn cues(url: &str, track: u64) -> Vec<CueOut> {
    let r = registry().lock().unwrap();
    let Some(e) = r.get(url) else { return vec![] };
    let s = e.0.lock().unwrap();
    build_cues(&s, track)
}

/// Cues for one track, or None when nothing changed since version `since`.
pub fn cues_since(url: &str, track: u64, since: Option<u64>) -> Option<CuesOut> {
    let mut r = registry().lock().unwrap();
    let e = r.get_mut(url)?;
    e.1 = tick();
    let s = e.0.lock().unwrap();
    if since == Some(s.ver) {
        return None;
    }
    Some(CuesOut { ver: s.ver, cues: build_cues(&s, track) })
}

/* ---------------- EBML helpers ---------------- */

fn read_id(b: &[u8]) -> Option<Option<(u32, usize)>> {
    let first = *b.first()?;
    let len = match first {
        x if x & 0x80 != 0 => 1,
        x if x & 0x40 != 0 => 2,
        x if x & 0x20 != 0 => 3,
        x if x & 0x10 != 0 => 4,
        _ => return Some(None), // invalid
    };
    if b.len() < len {
        return None;
    }
    let mut id = 0u32;
    for &x in &b[..len] {
        id = (id << 8) | x as u32;
    }
    Some(Some((id, len)))
}

/// returns (value, len, unknown_size)
fn read_vint(b: &[u8]) -> Option<Option<(u64, usize, bool)>> {
    let first = *b.first()?;
    if first == 0 {
        return Some(None);
    }
    let len = first.leading_zeros() as usize + 1;
    if b.len() < len {
        return None;
    }
    let mask = if len == 8 { 0 } else { 0xFFu8 >> len };
    let mut v = (first & mask) as u64;
    let mut all_ones = (first & mask) == mask;
    for &x in &b[1..len] {
        v = (v << 8) | x as u64;
        all_ones &= x == 0xFF;
    }
    Some(Some((v, len, all_ones)))
}

fn uint(b: &[u8]) -> u64 {
    b.iter().fold(0u64, |a, &x| (a << 8) | x as u64)
}

fn clean_text(codec: &str, raw: &str) -> String {
    let mut s = raw.to_string();
    if codec.contains("ASS") || codec.contains("SSA") {
        // ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        s = s.splitn(9, ',').nth(8).unwrap_or(&s).to_string();
        let mut out = String::with_capacity(s.len());
        let mut depth = 0;
        for ch in s.chars() {
            match ch {
                '{' => depth += 1,
                '}' if depth > 0 => depth -= 1,
                _ if depth == 0 => out.push(ch),
                _ => {}
            }
        }
        s = out.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ");
    }
    s.trim().to_string()
}

/* ---------------- streaming parser ---------------- */

pub struct Parser {
    st: Shared,
    buf: Vec<u8>,
    skip: u64,
    synced: bool,
    cluster_tc: Option<i64>,
    track: Option<SubTrack>,
    sub_numbers: HashSet<u64>,
    last_cue: Option<(u64, i64)>,
}

impl Parser {
    /// `from_start`: the response begins at byte 0 (else we resync on the next Cluster)
    pub fn new(url: &str, from_start: bool) -> Self {
        let st = state_for(url);
        let sub_numbers = st.lock().unwrap().tracks.iter().map(|t| t.number).collect();
        Parser { st, buf: Vec::new(), skip: 0, synced: from_start, cluster_tc: None, track: None, sub_numbers, last_cue: None }
    }

    fn finish_track(&mut self) {
        if let Some(t) = self.track.take() {
            if t.track_type == 0x11 {
                let mut st = self.st.lock().unwrap();
                if !st.tracks.iter().any(|x| x.number == t.number) {
                    self.sub_numbers.insert(t.number);
                    st.tracks.push(t);
                }
            }
        }
    }

    fn resync(&mut self) {
        self.synced = false;
    }

    pub fn feed(&mut self, mut data: &[u8]) {
        if self.skip > 0 {
            let n = (self.skip as usize).min(data.len());
            self.skip -= n as u64;
            data = &data[n..];
        }
        if data.is_empty() {
            return;
        }
        self.buf.extend_from_slice(data);
        self.parse();
    }

    fn parse(&mut self) {
        loop {
            if !self.synced {
                let pat = [0x1F, 0x43, 0xB6, 0x75];
                match self.buf.windows(4).position(|w| w == pat) {
                    Some(p) => {
                        // the 4 bytes can also occur by chance inside video data: a real
                        // Cluster is followed by its size and then Timecode (E7) or CRC-32 (BF)
                        match read_vint(&self.buf[p + 4..]) {
                            None => {
                                self.buf.drain(..p);
                                return;
                            }
                            Some(None) => {
                                self.buf.drain(..p + 1);
                                continue;
                            }
                            Some(Some((_, slen, _))) => {
                                let Some(&child) = self.buf.get(p + 4 + slen) else {
                                    self.buf.drain(..p);
                                    return;
                                };
                                if child != 0xE7 && child != 0xBF {
                                    self.buf.drain(..p + 1);
                                    continue;
                                }
                            }
                        }
                        self.buf.drain(..p);
                        self.synced = true;
                        self.cluster_tc = None;
                    }
                    None => {
                        let keep = self.buf.len().saturating_sub(3);
                        self.buf.drain(..keep);
                        return;
                    }
                }
            }
            let (id, idlen) = match read_id(&self.buf) {
                None => return,
                Some(None) => {
                    self.buf.drain(..1);
                    self.resync();
                    continue;
                }
                Some(Some(x)) => x,
            };
            let (size, slen, unknown) = match read_vint(&self.buf[idlen..]) {
                None => return,
                Some(None) => {
                    self.buf.drain(..1);
                    self.resync();
                    continue;
                }
                Some(Some(x)) => x,
            };
            let hl = idlen + slen;

            match id {
                ID_SEGMENT | ID_TRACKS | ID_INFO | ID_CONTENT_ENCODINGS | ID_CONTENT_ENCODING | ID_CONTENT_COMPRESSION => {
                    self.buf.drain(..hl);
                }
                ID_BLOCK_GROUP => {
                    self.last_cue = None;
                    self.buf.drain(..hl);
                }
                ID_TRACK_ENTRY => {
                    self.finish_track();
                    self.track = Some(SubTrack { lang: "eng".into(), default: true, ..Default::default() });
                    self.buf.drain(..hl);
                }
                ID_CLUSTER => {
                    self.finish_track();
                    self.cluster_tc = None;
                    self.buf.drain(..hl);
                }
                ID_SIMPLE_BLOCK | ID_BLOCK => {
                    if id == ID_SIMPLE_BLOCK {
                        self.last_cue = None;
                    }
                    if unknown {
                        self.buf.drain(..1);
                        self.resync();
                        continue;
                    }
                    let Some(Some((track, _, _))) = read_vint(&self.buf[hl.min(self.buf.len())..]) else {
                        if self.buf.len() > hl + 8 {
                            self.buf.drain(..1);
                            self.resync();
                            continue;
                        }
                        return;
                    };
                    if size > MAX_BLOCK {
                        self.buf.drain(..1);
                        self.resync();
                        continue;
                    }
                    if self.sub_numbers.contains(&track) && size < MAX_LEAF {
                        let total = hl + size as usize;
                        if self.buf.len() < total {
                            return;
                        }
                        let payload: Vec<u8> = self.buf[hl..total].to_vec();
                        self.buf.drain(..total);
                        self.on_block(&payload);
                    } else {
                        self.skip_bytes(hl, size);
                    }
                }
                _ if LEVEL1.contains(&id) => {
                    self.finish_track();
                    if unknown {
                        self.buf.drain(..hl);
                    } else if size > MAX_SKIP {
                        self.buf.drain(..1);
                        self.resync();
                    } else {
                        self.skip_bytes(hl, size);
                    }
                }
                ID_EBML => self.skip_bytes(hl, size),
                ID_CLUSTER_TIMECODE | ID_BLOCK_DURATION | ID_TIMECODE_SCALE | ID_TRACK_NUMBER | ID_TRACK_TYPE | ID_CODEC_ID | ID_LANGUAGE
                | ID_LANGUAGE_BCP47 | ID_NAME | ID_FLAG_DEFAULT | ID_FLAG_FORCED | ID_COMP_ALGO | ID_COMP_SETTINGS => {
                    if unknown || size > MAX_LEAF {
                        self.buf.drain(..1);
                        self.resync();
                        continue;
                    }
                    let total = hl + size as usize;
                    if self.buf.len() < total {
                        return;
                    }
                    let v: Vec<u8> = self.buf[hl..total].to_vec();
                    self.buf.drain(..total);
                    self.on_leaf(id, &v);
                }
                _ => {
                    if unknown {
                        self.buf.drain(..hl);
                    } else if size > MAX_SKIP {
                        self.buf.drain(..1);
                        self.resync();
                    } else {
                        self.skip_bytes(hl, size);
                    }
                }
            }
        }
    }

    fn skip_bytes(&mut self, hl: usize, size: u64) {
        let avail = (self.buf.len() - hl) as u64;
        if avail >= size {
            self.buf.drain(..hl + size as usize);
        } else {
            self.skip = size - avail;
            self.buf.clear();
        }
    }

    fn on_leaf(&mut self, id: u32, v: &[u8]) {
        let s = || String::from_utf8_lossy(v).trim_end_matches('\0').to_string();
        match id {
            ID_CLUSTER_TIMECODE => self.cluster_tc = Some(uint(v) as i64),
            ID_TIMECODE_SCALE => {
                let sc = uint(v);
                if sc > 0 {
                    self.st.lock().unwrap().scale = sc;
                }
            }
            ID_BLOCK_DURATION => {
                if let Some((track, start)) = self.last_cue.take() {
                    let mut st = self.st.lock().unwrap();
                    let scale = st.scale as i64;
                    let end = start + uint(v) as i64 * scale / 1_000_000;
                    let changed = match st.cues.get_mut(&track).and_then(|m| m.get_mut(&start)) {
                        Some(c) if c.end_ms != Some(end) => {
                            c.end_ms = Some(end);
                            true
                        }
                        _ => false,
                    };
                    if changed {
                        st.ver += 1;
                    }
                }
            }
            _ => {
                let Some(t) = self.track.as_mut() else { return };
                match id {
                    ID_TRACK_NUMBER => t.number = uint(v),
                    ID_TRACK_TYPE => t.track_type = uint(v),
                    ID_CODEC_ID => {
                        t.codec = s();
                        t.text = t.codec.starts_with("S_TEXT") || t.codec == "S_SSA" || t.codec == "S_ASS";
                    }
                    ID_LANGUAGE => t.lang = s(),
                    ID_LANGUAGE_BCP47 => t.lang = s(),
                    ID_NAME => t.name = s(),
                    ID_FLAG_DEFAULT => t.default = uint(v) != 0,
                    ID_FLAG_FORCED => t.forced = uint(v) != 0,
                    ID_COMP_ALGO => t.comp_algo = Some(uint(v)),
                    ID_COMP_SETTINGS => t.comp_settings = v.to_vec(),
                    _ => {}
                }
            }
        }
    }

    fn on_block(&mut self, p: &[u8]) {
        let Some(Some((track, tl, _))) = read_vint(p) else { return };
        if p.len() < tl + 3 {
            return;
        }
        let Some(ctc) = self.cluster_tc else { return };
        let rel = i16::from_be_bytes([p[tl], p[tl + 1]]) as i64;
        let frame = &p[tl + 3..];
        let (codec, algo, settings) = {
            let st = self.st.lock().unwrap();
            match st.tracks.iter().find(|t| t.number == track) {
                Some(t) if t.text => (t.codec.clone(), t.comp_algo, t.comp_settings.clone()),
                _ => return,
            }
        };
        let bytes: Vec<u8> = match algo {
            Some(0) => {
                let mut out = Vec::new();
                if flate2::read::ZlibDecoder::new(frame).read_to_end(&mut out).is_err() {
                    return;
                }
                out
            }
            Some(3) => [settings.as_slice(), frame].concat(),
            _ => frame.to_vec(),
        };
        let text = clean_text(&codec, &String::from_utf8_lossy(&bytes));
        if text.is_empty() {
            return;
        }
        let mut st = self.st.lock().unwrap();
        let start_ms = (ctc + rel) * st.scale as i64 / 1_000_000;
        let mut changed = true;
        match st.cues.entry(track).or_default().entry(start_ms) {
            std::collections::btree_map::Entry::Occupied(mut o) => {
                // two lines starting together (two speakers / top+bottom) must both show;
                // the same block seen again after a seek must not be duplicated
                let c = o.get_mut();
                if c.text == text || c.text.split('\n').any(|l| l == text) {
                    changed = false;
                } else {
                    c.text.push('\n');
                    c.text.push_str(&text);
                }
            }
            std::collections::btree_map::Entry::Vacant(v) => {
                v.insert(StoredCue { end_ms: None, text });
            }
        }
        if changed {
            st.ver += 1;
        }
        self.last_cue = Some((track, start_ms));
    }
}

/// Read wrapper that feeds everything passing through to the parser.
pub struct Tee<R: Read> {
    pub inner: R,
    pub parser: Parser,
}

impl<R: Read> Read for Tee<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.parser.feed(&buf[..n]);
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_file(url: &str, data: &[u8], from: usize, chunk: usize) {
        let mut p = Parser::new(url, from == 0);
        for c in data[from..].chunks(chunk) {
            p.feed(c);
        }
    }

    #[test]
    fn parses_test5() {
        let Ok(path) = std::env::var("MKV_TEST_FILE") else { return };
        let data = std::fs::read(path).unwrap();
        let url = "test://5";
        feed_file(url, &data, 0, 7919); // odd chunk size exercises buffering
        let t = tracks(url);
        for x in &t {
            println!("track {} {} {} '{}' default={} text={}", x.number, x.codec, x.lang, x.name, x.default, x.text);
        }
        assert!(!t.is_empty(), "no subtitle tracks");
        let c = cues(url, t[0].number);
        println!("{} cues; first: {:?}", c.len(), c.iter().take(3).map(|x| (x.start, x.end, x.text.clone())).collect::<Vec<_>>());
        assert!(!c.is_empty(), "no cues");

        // a range request starting mid-file must resync on the next cluster
        let url2 = "test://5b";
        feed_file(url2, &data, 0, 65536);
        let before = cues(url2, t[0].number).len();
        feed_file(url2, &data, data.len() / 2 + 12345, 4096);
        assert_eq!(cues(url2, t[0].number).len(), before, "mid-file pass should only re-add existing cues");
    }
}

#[cfg(test)]
mod synthetic_tests {
    use super::*;

    fn el(id: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut v = id.to_vec();
        v.push(0x01); // 8-byte size
        v.extend_from_slice(&(payload.len() as u64).to_be_bytes()[1..]);
        v.extend_from_slice(payload);
        v
    }

    fn header() -> Vec<u8> {
        let entry = [
            el(&[0xD7], &[1]),
            el(&[0x83], &[0x11]),
            el(&[0x86], b"S_TEXT/UTF8"),
            el(&[0x22, 0xB5, 0x9C], b"por"),
        ]
        .concat();
        let tracks = el(&[0x16, 0x54, 0xAE, 0x6B], &el(&[0xAE], &entry));
        [el(&[0x1A, 0x45, 0xDF, 0xA3], &[]), el(&[0x18, 0x53, 0x80, 0x67], &tracks)].concat()
    }

    fn block(rel: i16, text: &str) -> Vec<u8> {
        let mut p = vec![0x81]; // track 1
        p.extend_from_slice(&rel.to_be_bytes());
        p.push(0);
        p.extend_from_slice(text.as_bytes());
        el(&[0xA3], &p)
    }

    fn cluster(tc: u8, blocks: &[Vec<u8>]) -> Vec<u8> {
        el(&[0x1F, 0x43, 0xB6, 0x75], &[el(&[0xE7], &[tc]), blocks.concat()].concat())
    }

    #[test]
    fn simultaneous_cues_are_merged_and_not_duplicated() {
        let url = "test://synthetic-merge";
        let data = [header(), cluster(5, &[block(0, "Hello"), block(0, "Olá")])].concat();
        let mut p = Parser::new(url, true);
        p.feed(&data);
        let c = cues(url, 1);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].text, "Hello\nOlá");
        let v = cues_since(url, 1, None).unwrap().ver;
        // the same cluster seen again (seek back) changes nothing
        let mut p2 = Parser::new(url, false);
        p2.feed(&cluster(5, &[block(0, "Hello"), block(0, "Olá")]));
        assert!(cues_since(url, 1, Some(v)).is_none());
    }

    #[test]
    fn false_cluster_pattern_in_video_data_does_not_blind_the_parser() {
        let url = "test://synthetic-resync";
        let mut p = Parser::new(url, true);
        p.feed(&[header(), cluster(0, &[])].concat());
        // mid-file connection: starts with junk that contains the Cluster id by chance,
        // followed by an absurd "size" that would make the old parser skip everything
        let mut p2 = Parser::new(url, false);
        let mut junk = vec![0x55, 0x1F, 0x43, 0xB6, 0x75, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE, 0x42, 0x42];
        junk.extend(std::iter::repeat(0x99).take(64));
        p2.feed(&junk);
        p2.feed(&cluster(9, &[block(100, "after junk")]));
        let c = cues(url, 1);
        assert_eq!(c.len(), 1, "cue after the junk must still be parsed");
        assert_eq!(c[0].text, "after junk");
    }
}
