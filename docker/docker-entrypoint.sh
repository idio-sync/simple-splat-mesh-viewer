#!/bin/sh
set -e

# Substitute environment variables in the config template
envsubst '${DEFAULT_ARCHIVE_URL} ${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${DEFAULT_POINTCLOUD_URL} ${SHOW_CONTROLS} ${ALLOWED_DOMAINS} ${KIOSK_LOCK} ${ARCHIVE_PATH_PREFIX} ${LOD_BUDGET_SD} ${LOD_BUDGET_HD}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js

# Substitute environment variables in the nginx config template
envsubst '${FRAME_ANCESTORS}' \
    < /etc/nginx/templates/nginx.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "Configuration generated:"
echo "  DEFAULT_ARCHIVE_URL: ${DEFAULT_ARCHIVE_URL:-<not set>}"
echo "  DEFAULT_SPLAT_URL: ${DEFAULT_SPLAT_URL:-<not set>}"
echo "  DEFAULT_MODEL_URL: ${DEFAULT_MODEL_URL:-<not set>}"
echo "  DEFAULT_POINTCLOUD_URL: ${DEFAULT_POINTCLOUD_URL:-<not set>}"
echo "  SHOW_CONTROLS: ${SHOW_CONTROLS}"
echo "  ALLOWED_DOMAINS: ${ALLOWED_DOMAINS:-<not set>}"
echo "  FRAME_ANCESTORS: ${FRAME_ANCESTORS}"
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

    # Auto-extract metadata from archives on startup
    echo ""
    echo "Extracting metadata from archives..."
    /opt/extract-meta.sh /usr/share/nginx/html /usr/share/nginx/html

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

    # Start the meta-server as a background process
    SITE_NAME="${SITE_NAME}" \
    SITE_URL="${SITE_URL}" \
    SITE_DESCRIPTION="${SITE_DESCRIPTION}" \
    OEMBED_WIDTH="${OEMBED_WIDTH}" \
    OEMBED_HEIGHT="${OEMBED_HEIGHT}" \
    node /opt/meta-server.js &

    echo ""
    echo "Meta-server started on port 3001"
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

# Execute the main command
exec "$@"
