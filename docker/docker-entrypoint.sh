#!/bin/sh
set -e

# Substitute environment variables in the config template
envsubst '${DEFAULT_ARCHIVE_URL} ${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${DEFAULT_POINTCLOUD_URL} ${SHOW_CONTROLS} ${ALLOWED_DOMAINS} ${KIOSK_LOCK} ${ARCHIVE_PATH_PREFIX} ${LOD_BUDGET_SD} ${LOD_BUDGET_HD} ${ADMIN_ENABLED} ${CHUNKED_UPLOAD}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js

# Substitute environment variables in the nginx config template
SERVER_NAMES="${SERVER_NAMES:-localhost}"
envsubst '${FRAME_ANCESTORS} ${SERVER_NAMES} ${SITE_URL}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

# Generate CORS origin map from CORS_ORIGINS env var
# CORS_ORIGINS is a space-separated list of allowed origins (e.g., "https://app.example.com https://portal.example.com")
# When empty (default), no Access-Control-Allow-Origin header is emitted (same-origin only)
if [ -n "${CORS_ORIGINS}" ]; then
    {
        echo 'map $http_origin $cors_origin {'
        echo '    default "";'
        for origin in ${CORS_ORIGINS}; do
            echo "    \"${origin}\" \"${origin}\";"
        done
        echo '}'
    } > /etc/nginx/conf.d/cors-origins-map.conf.inc
else
    # No CORS origins — $cors_origin is always empty, so no header is emitted
    cat > /etc/nginx/conf.d/cors-origins-map.conf.inc <<'CORSEOF'
map $http_origin $cors_origin {
    default "";
}
CORSEOF
fi

echo "Configuration generated:"
echo "  DEFAULT_ARCHIVE_URL: ${DEFAULT_ARCHIVE_URL:-<not set>}"
echo "  DEFAULT_SPLAT_URL: ${DEFAULT_SPLAT_URL:-<not set>}"
echo "  DEFAULT_MODEL_URL: ${DEFAULT_MODEL_URL:-<not set>}"
echo "  DEFAULT_POINTCLOUD_URL: ${DEFAULT_POINTCLOUD_URL:-<not set>}"
echo "  SHOW_CONTROLS: ${SHOW_CONTROLS}"
echo "  ALLOWED_DOMAINS: ${ALLOWED_DOMAINS:-<not set>}"
echo "  FRAME_ANCESTORS: ${FRAME_ANCESTORS}"
echo "  SERVER_NAMES: ${SERVER_NAMES:-localhost}"
echo "  CORS_ORIGINS: ${CORS_ORIGINS:-<not set, same-origin only>}"
echo "  ARCHIVE_PATH_PREFIX: ${ARCHIVE_PATH_PREFIX:-<not set>}"

# Generate kiosk-lock nginx rules
if [ "${KIOSK_LOCK}" = "true" ]; then
    cat > /etc/nginx/conf.d/kiosk-lock.conf.inc <<'LOCKEOF'
# Block editor-only modules when KIOSK_LOCK is active
location ~ /modules/(archive-creator|share-dialog|kiosk-viewer)\.js$ {
    return 403;
}
LOCKEOF
    echo "  KIOSK_LOCK: ACTIVE (editor modules blocked)"
else
    : > /etc/nginx/conf.d/kiosk-lock.conf.inc
    echo "  KIOSK_LOCK: off"
fi

# Generate embed referer check rules
if [ -n "${EMBED_REFERERS}" ]; then
    cat > /etc/nginx/conf.d/embed-referers.conf.inc <<REFEOF
valid_referers none server_names ${EMBED_REFERERS};
if (\$invalid_referer) {
    return 403;
}
REFEOF
    echo "  EMBED_REFERERS: ${EMBED_REFERERS}"
else
    : > /etc/nginx/conf.d/embed-referers.conf.inc
    echo "  EMBED_REFERERS: off (all referers allowed)"
fi

# Initialize conditional includes as empty (populated below if applicable)
: > /etc/nginx/conf.d/view-proxy.conf.inc

# --- Admin panel support ---

if [ "${ADMIN_ENABLED}" = "true" ]; then
    echo ""
    echo "Admin panel: ENABLED"

    if [ -z "${ADMIN_PASS}" ]; then
        echo "ERROR: ADMIN_PASS is required when ADMIN_ENABLED=true"
        exit 1
    fi

    # Generate htpasswd file using openssl (available in Alpine)
    printf "%s:%s\n" "${ADMIN_USER:-admin}" "$(openssl passwd -apr1 "${ADMIN_PASS}")" > /etc/nginx/.htpasswd
    echo "  ADMIN_USER: ${ADMIN_USER:-admin}"
    echo "  MAX_UPLOAD_SIZE: ${MAX_UPLOAD_SIZE:-1024}MB"
    echo "  CHUNKED_UPLOAD: ${CHUNKED_UPLOAD:-false}"

    # Generate admin nginx config snippet
    cat > /etc/nginx/conf.d/admin-auth.conf.inc <<ADMINEOF
# Admin panel — proxied to meta-server, protected by basic auth
location /admin {
    auth_basic "Vitrine3D Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
}

# API routes — proxied to meta-server, protected by basic auth
location /api/ {
    auth_basic "Vitrine3D Admin";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Large upload support
    client_max_body_size ${MAX_UPLOAD_SIZE:-1024}m;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
ADMINEOF

    # Check archives directory is writable
    if [ ! -w "/usr/share/nginx/html/archives/" ]; then
        echo "  WARNING: /usr/share/nginx/html/archives/ is not writable."
        echo "  Mount with :rw for upload/delete/rename to work."
    fi
else
    : > /etc/nginx/conf.d/admin-auth.conf.inc
    echo ""
    echo "Admin panel: disabled (set ADMIN_ENABLED=true to enable)"
fi

# --- OG/oEmbed link preview support ---

if [ "${OG_ENABLED}" = "true" ]; then
    echo ""
    echo "OG/oEmbed link previews: ENABLED"
    echo "  SITE_NAME: ${SITE_NAME}"
    echo "  SITE_URL: ${SITE_URL:-<not set — required for OG URLs>}"
    echo "  SITE_DESCRIPTION: ${SITE_DESCRIPTION}"
    echo "  OEMBED_WIDTH: ${OEMBED_WIDTH}"
    echo "  OEMBED_HEIGHT: ${OEMBED_HEIGHT}"

    if [ -z "${SITE_URL}" ]; then
        echo "  WARNING: SITE_URL is not set. OG meta tags and oEmbed will use relative URLs."
        echo "  Set SITE_URL to your canonical viewer URL (e.g., https://viewer.yourcompany.com)"
    fi

    # Check for operator-provided default thumbnail
    if [ -f /usr/share/nginx/html/thumbs/default.jpg ]; then
        echo "  Default thumbnail: found"
    else
        echo "  Default thumbnail: NOT FOUND"
        echo "  Mount a default.jpg to /usr/share/nginx/html/thumbs/default.jpg for fallback previews"
    fi

    # Generate root location with bot detection
    # Uses rewrite to internal location (safe nginx pattern — avoids proxy_pass inside if)
    cat > /etc/nginx/conf.d/og-location-root.conf.inc <<'ROOTEOF'
location / {
    if ($is_bot) {
        rewrite ^(.*)$ /__og_bot_proxy$1 last;
    }
    try_files $uri $uri/ /index.html;
}
ROOTEOF

    # Generate oEmbed endpoint + internal bot proxy location
    cat > /etc/nginx/conf.d/og-oembed.conf.inc <<'OEMBEDEOF'
# oEmbed endpoint — always proxied to meta-server (not just for bots)
location /oembed {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Internal location for bot-proxied requests (rewritten from location /)
location /__og_bot_proxy {
    internal;
    rewrite ^/__og_bot_proxy(.*)$ $1 break;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
OEMBEDEOF

else
    # OG disabled — generate plain root location and empty oEmbed include
    cat > /etc/nginx/conf.d/og-location-root.conf.inc <<'ROOTEOF'
location / {
    try_files $uri $uri/ /index.html;
}
ROOTEOF
    : > /etc/nginx/conf.d/og-oembed.conf.inc
    echo ""
    echo "OG/oEmbed link previews: disabled (set OG_ENABLED=true to enable)"
fi

# --- Start meta-server if any feature needs it ---

if [ "${OG_ENABLED}" = "true" ] || [ "${ADMIN_ENABLED}" = "true" ]; then
    # Auto-extract metadata from archives on startup
    echo ""
    echo "Extracting metadata from archives..."
    /opt/extract-meta.sh /usr/share/nginx/html /usr/share/nginx/html

    # Generate clean archive URL proxy: /view/{hash|uuid} → meta-server
    cat > /etc/nginx/conf.d/view-proxy.conf.inc <<'VIEWEOF'
# UUID v4 format: /view/{8-4-4-4-12 hex with dashes}
location ~ "^/view/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
# Legacy 16-hex-char hash format: /view/{hash}
location ~ "^/view/[a-f0-9]{16}$" {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
VIEWEOF
    echo "  Clean URLs: /view/{uuid} and /view/{hash} enabled"

    SITE_NAME="${SITE_NAME}" \
    SITE_URL="${SITE_URL}" \
    SITE_DESCRIPTION="${SITE_DESCRIPTION}" \
    OEMBED_WIDTH="${OEMBED_WIDTH}" \
    OEMBED_HEIGHT="${OEMBED_HEIGHT}" \
    ADMIN_ENABLED="${ADMIN_ENABLED}" \
    MAX_UPLOAD_SIZE="${MAX_UPLOAD_SIZE:-1024}" \
    DEFAULT_KIOSK_THEME="${DEFAULT_KIOSK_THEME}" \
    node /opt/meta-server.js &

    echo ""
    echo "Meta-server started on port 3001"
fi

# Execute the main command
exec "$@"
