use std::{env, fs};

fn main() {
    // TMDB key is compiled into the binary (never shipped in JS, settings or git).
    // Source: env var TMDB_API_KEY (CI secret) or the git-ignored file src-tauri/tmdb.key.
    println!("cargo:rerun-if-env-changed=TMDB_API_KEY");
    println!("cargo:rerun-if-changed=tmdb.key");
    let key = env::var("TMDB_API_KEY")
        .ok()
        .or_else(|| fs::read_to_string("tmdb.key").ok())
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    if let Some(k) = key {
        println!("cargo:rustc-env=HTV_TMDB_KEY={k}");
    }
    tauri_build::build()
}
