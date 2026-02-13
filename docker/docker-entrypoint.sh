#!/bin/sh
set -e

# Substitute environment variables in the config template
envsubst '${DEFAULT_ARCHIVE_URL} ${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${DEFAULT_POINTCLOUD_URL} ${DEFAULT_ALIGNMENT_URL} ${SHOW_CONTROLS} ${ALLOWED_DOMAINS} ${KIOSK_LOCK} ${ARCHIVE_PATH_PREFIX}' \
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
echo "  DEFAULT_ALIGNMENT_URL: ${DEFAULT_ALIGNMENT_URL:-<not set>}"
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

# Execute the main command
exec "$@"
