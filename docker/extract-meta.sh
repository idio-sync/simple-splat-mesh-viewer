#!/bin/sh
#
# extract-meta.sh — Extract metadata and thumbnails from Vitrine3D archives
#
# Scans a directory for .a3d/.a3z files, extracts manifest metadata and
# preview thumbnails into sidecar files for the meta-server.
#
# Usage:
#   ./extract-meta.sh [archives-dir] [output-root] [single-file]
#
# Defaults:
#   archives-dir:  /usr/share/nginx/html (scans recursively)
#   output-root:   /usr/share/nginx/html
#   single-file:   (optional) Process only this specific file
#
# Output:
#   {output-root}/meta/{hash}.json    — metadata sidecar
#   {output-root}/thumbs/{hash}.jpg   — extracted thumbnail
#
# Dependencies: unzip, python3 (for JSON parsing), sha256sum

set -e

ARCHIVES_DIR="${1:-/usr/share/nginx/html}"
OUTPUT_ROOT="${2:-/usr/share/nginx/html}"
SINGLE_FILE="${3:-}"
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

    # Skip if already extracted (idempotent) — but re-extract if thumbnail is missing
    if [ -f "$meta_file" ]; then
        if grep -q '"thumbnail": "/thumbs/' "$meta_file" 2>/dev/null && [ ! -f "$thumb_file" ]; then
            echo "  [re-extract] $rel_url (thumbnail missing)"
        else
            echo "  [skip] $rel_url (already extracted)"
            return
        fi
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

    # Extract assets list and metadata fields from manifest using python3
    local assets_json="[]"
    local metadata_json="{}"

    if [ -n "$manifest" ]; then
        assets_json=$(echo "$manifest" | python3 -c "
import sys, json
try:
    m = json.load(sys.stdin)
    entries = m.get('data_entries', {})
    assets = []
    type_map = {
        'scene_': 'splat', 'mesh_': 'mesh', 'pointcloud_': 'pointcloud',
        'cad_': 'cad', 'drawing_': 'drawing'
    }
    for key, entry in entries.items():
        # Skip thumbnails, images, source files
        asset_type = None
        for prefix, atype in type_map.items():
            if key.startswith(prefix):
                asset_type = atype
                break
        if not asset_type:
            continue
        # Skip proxy entries
        if entry.get('lod') == 'proxy' or '_proxy' in key:
            continue
        fname = entry.get('file_name', '')
        ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else ''
        assets.append({
            'key': key,
            'type': asset_type,
            'format': ext,
            'size_bytes': entry.get('size_bytes', 0) or 0
        })
    print(json.dumps(assets))
except:
    print('[]')
" 2>/dev/null) || assets_json="[]"

        metadata_json=$(echo "$manifest" | python3 -c "
import sys, json
try:
    m = json.load(sys.stdin)
    filled = {}
    # Project fields
    p = m.get('project', {})
    for f in ['title','description','license','tags','id']:
        v = p.get(f)
        if v and (not isinstance(v, list) or len(v) > 0):
            filled['project.' + f] = True
    # Provenance fields
    prov = m.get('provenance', {})
    for f in ['capture_date','capture_device','operator','location','processing_notes']:
        if prov.get(f):
            filled['provenance.' + f] = True
    sw = prov.get('processing_software', [])
    if sw and len(sw) > 0 and sw[0].get('name'):
        filled['provenance.processing_software'] = True
    # Quality metrics
    q = m.get('quality_metrics', {})
    for f in ['tier','accuracy_grade']:
        if q.get(f):
            filled['quality.' + f] = True
    cr = q.get('capture_resolution', {})
    if cr.get('value') is not None and cr.get('value') != 0:
        filled['quality.capture_resolution'] = True
    # Archival record
    ar = m.get('archival_record', {})
    if ar.get('title'):
        filled['archival.title'] = True
    c = ar.get('creation', {})
    for f in ['creator','date_created','period','culture']:
        if c.get(f):
            filled['archival.' + f] = True
    pd = ar.get('physical_description', {})
    if pd.get('medium'):
        filled['archival.medium'] = True
    cov = ar.get('coverage', {})
    sp = cov.get('spatial', {})
    if sp.get('location_name'):
        filled['archival.location'] = True
    # Annotations count
    ann = m.get('annotations', [])
    if ann and len(ann) > 0:
        filled['annotations'] = len(ann)
    # Viewer settings
    vs = m.get('viewer_settings', {})
    if vs.get('display_mode'):
        filled['viewer.display_mode'] = vs['display_mode']
    print(json.dumps(filled))
except:
    print('{}')
" 2>/dev/null) || metadata_json="{}"
    fi

    # Use python3 to write proper JSON (handles escaping)
    python3 -c "
import json, sys
data = {
    'title': sys.argv[1],
    'description': sys.argv[2],
    'thumbnail': sys.argv[3],
    'archive_url': sys.argv[4],
    'assets': json.loads(sys.argv[6]),
    'metadata_fields': json.loads(sys.argv[7])
}
with open(sys.argv[5], 'w') as f:
    json.dump(data, f, indent=2)
" "$title" "$description" "$thumb_url" "$rel_url" "$meta_file" "$assets_json" "$metadata_json"

    echo "    title: $title"
    [ -n "$thumb_url" ] && echo "    thumb: $thumb_url" || echo "    thumb: (none)"
}

# --- Main ---

if [ -n "$SINGLE_FILE" ]; then
    # Single-file mode: process one specific file (used by admin upload)
    if [ -f "$SINGLE_FILE" ]; then
        echo "[extract-meta] Processing single file: $SINGLE_FILE"
        # Force re-extraction by removing existing sidecar
        rel_url=$(relative_url "$SINGLE_FILE")
        hash=$(archive_hash "$rel_url")
        rm -f "$META_DIR/$hash.json"
        process_archive "$SINGLE_FILE"
    else
        echo "[extract-meta] File not found: $SINGLE_FILE"
    fi
else
    # Batch mode: scan directory recursively
    echo "[extract-meta] Scanning $ARCHIVES_DIR for .a3d/.a3z files..."

    count=0
    find "$ARCHIVES_DIR" -type f \( -name "*.a3d" -o -name "*.a3z" \) | while read -r archive; do
        process_archive "$archive"
        count=$((count + 1))
    done
fi

echo "[extract-meta] Done."
