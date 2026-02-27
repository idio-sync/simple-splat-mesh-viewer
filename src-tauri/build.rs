fn main() {
    // Forward archive encryption key to Rust compilation (set by build-branded.mjs --encrypt)
    if let Ok(key) = std::env::var("VITRINE_ARCHIVE_KEY") {
        println!("cargo:rustc-env=VITRINE_ARCHIVE_KEY={}", key);
    }
    tauri_build::build()
}
