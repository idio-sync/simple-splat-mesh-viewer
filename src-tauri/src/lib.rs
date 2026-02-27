use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

// =============================================================================
// IPC FILE HANDLE STORE
// =============================================================================

struct FileHandle {
    file: File,
    #[allow(dead_code)]
    size: u64,
}

#[derive(Default)]
struct FileHandleStore {
    handles: Mutex<HashMap<String, FileHandle>>,
}

// =============================================================================
// IPC COMMANDS — byte-level random access to files on disk
// =============================================================================

/// Open a file and return a handle ID + file size.
/// The handle stays open until ipc_close_file is called.
#[tauri::command]
fn ipc_open_file(path: String, store: State<FileHandleStore>) -> Result<(String, u64), String> {
    let file = File::open(&path).map_err(|e| format!("Failed to open {}: {}", path, e))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    let id = Uuid::new_v4().to_string();
    store.handles.lock().unwrap().insert(id.clone(), FileHandle { file, size });
    Ok((id, size))
}

/// Read `length` bytes starting at `offset` from an open file handle.
/// Returns raw bytes via tauri::ipc::Response to avoid JSON serialization
/// (Vec<u8> would be serialized as a JSON array of numbers, which for a 150MB
/// file means ~600MB of JSON text — enough to crash the webview).
/// If compiled with VITRINE_ARCHIVE_KEY, XOR-decodes the bytes on the fly.
#[tauri::command]
fn ipc_read_bytes(
    handle_id: String,
    offset: u64,
    length: u32,
    store: State<FileHandleStore>,
) -> Result<tauri::ipc::Response, String> {
    let mut handles = store.handles.lock().unwrap();
    let entry = handles
        .get_mut(&handle_id)
        .ok_or_else(|| format!("Invalid file handle: {}", handle_id))?;
    entry
        .file
        .seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; length as usize];
    entry.file.read_exact(&mut buf).map_err(|e| e.to_string())?;

    // XOR-decode if this binary was compiled with an archive encryption key
    if let Some(key_hex) = option_env!("VITRINE_ARCHIVE_KEY") {
        if let Ok(key) = hex::decode(key_hex) {
            let key_len = key.len();
            for (i, byte) in buf.iter_mut().enumerate() {
                *byte ^= key[(offset as usize + i) % key_len];
            }
        }
    }

    Ok(tauri::ipc::Response::new(buf))
}

/// Close an open file handle and release its resources.
#[tauri::command]
fn ipc_close_file(handle_id: String, store: State<FileHandleStore>) -> Result<(), String> {
    store.handles.lock().unwrap().remove(&handle_id);
    Ok(())
}

// =============================================================================
// APP ENTRY
// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FileHandleStore::default())
        .invoke_handler(tauri::generate_handler![
            ipc_open_file,
            ipc_read_bytes,
            ipc_close_file
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
