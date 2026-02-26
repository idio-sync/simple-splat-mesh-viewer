#!/bin/sh
#
# extract-meta.sh — Extract metadata and thumbnails from Vitrine3D archives
#
# Scans a directory for .a3d/.a3z files, extracts manifest metadata and
# preview thumbnails into sidecar files for the meta-server.
#
# Usage:
#   ./extract-meta.sh [archives-dir] [output-root]
#
# Defaults:
#   archives-dir:  /usr/share/nginx/html (scans recursively)
#   output-root:   /usr/share/nginx/html
#
# Output:
#   {output-root}/meta/{hash}.json    — metadata sidecar
#   {output-root}/thumbs/{hash}.jpg   — extracted thumbnail
#
# Dependencies: unzip, python3 (for JSON parsing), sha256sum

set -e

ARCHIVES_DIR="${1:-/usr/share/nginx/html}"
OUTPUT_ROOT="${2:-/usr/share/nginx/html}"
META_DIR="$OUTPUT_ROOT/meta"
THUMBS_DIR="$OUTPUT_ROOT/thumbs"

mkdir -p "$META_DIR" "$THUMBS_DIR"

# Compute a truncated SHA-256 hash of a string (16 hex chars)
archive_hash() {
    printf '%s' "$1" | sha256sum | cut -c1-16
}

# Extract the archive-relative URL path from an absolute filesystem path
# e.g., /usr/share/nginx/html/archives/scan.a3d -> /archives/scan.a3d
relative_url() {
    echo "$1" | sed "s|^$OUTPUT_ROOT||"
}

# Process a single archive file
process_archive() {
    local archive_path="$1"
    local rel_url
    rel_url=$(relative_url "$archive_path")
    local hash
    hash=$(archive_hash "$rel_url")

    local meta_file="$META_DIR/$hash.json"
    local thumb_file="$THUMBS_DIR/$hash.jpg"

    # Skip if already extracted (idempotent)
    if [ -f "$meta_file" ]; then
        echo "  [skip] $rel_url (already extracted)"
        return
    fi

    echo "  [extract] $rel_url -> $hash"

    # Try to extract manifest.json from the archive
    local manifest=""
    manifest=$(unzip -p "$archive_path" "manifest.json" 2>/dev/null) || true

    # Parse title and description from manifest
    local title=""
    local description=""

    if [ -n "$manifest" ]; then
        # Use python3 for reliable JSON parsing
        title=$(echo "$manifest" | python3 -c "
import sys, json
try:
    m = json.load(sys.stdin)
    p = m.get('project', {})
    print(p.get('title', ''))
except: pass
" 2>/dev/null) || true

        description=$(echo "$manifest" | python3 -c "
import sys, json
try:
    m = json.load(sys.stdin)
    p = m.get('project', {})
    print(p.get('description', ''))
except: pass
" 2>/dev/null) || true
    fi

    # Fall back to filename as title
    if [ -z "$title" ]; then
        title=$(basename "$archive_path" | sed 's/\.\(a3d\|a3z\)$//')
    fi

    # Try to extract preview thumbnail
    # Archives store thumbnails as preview.jpg, thumbnail_0.png, or similar
    local has_thumb="false"
    for thumb_name in "preview.jpg" "preview.png" "thumbnail_0.png" "thumbnail_0.jpg"; do
        if unzip -l "$archive_path" "$thumb_name" >/dev/null 2>&1; then
            unzip -p "$archive_path" "$thumb_name" > "$thumb_file" 2>/dev/null && has_thumb="true"
            break
        fi
    done

    # Write metadata sidecar JSON
    local thumb_url=""
    if [ "$has_thumb" = "true" ]; then
        thumb_url="/thumbs/$hash.jpg"
    fi

    # Use python3 to write proper JSON (handles escaping)
    python3 -c "
import json, sys
data = {
    'title': sys.argv[1],
    'description': sys.argv[2],
    'thumbnail': sys.argv[3],
    'archive_url': sys.argv[4]
}
with open(sys.argv[5], 'w') as f:
    json.dump(data, f, indent=2)
" "$title" "$description" "$thumb_url" "$rel_url" "$meta_file"

    echo "    title: $title"
    [ -n "$thumb_url" ] && echo "    thumb: $thumb_url" || echo "    thumb: (none)"
}

# --- Main ---

echo "[extract-meta] Scanning $ARCHIVES_DIR for .a3d/.a3z files..."

count=0
find "$ARCHIVES_DIR" -type f \( -name "*.a3d" -o -name "*.a3z" \) | while read -r archive; do
    process_archive "$archive"
    count=$((count + 1))
done

echo "[extract-meta] Done."
