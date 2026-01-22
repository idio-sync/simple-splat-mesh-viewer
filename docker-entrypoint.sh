#!/bin/sh
set -e

# Substitute environment variables in the config template
envsubst '${DEFAULT_SPLAT_URL} ${DEFAULT_MODEL_URL} ${SHOW_CONTROLS}' \
    < /usr/share/nginx/html/config.js.template \
    > /usr/share/nginx/html/config.js

echo "Configuration generated:"
echo "  DEFAULT_SPLAT_URL: ${DEFAULT_SPLAT_URL:-<not set>}"
echo "  DEFAULT_MODEL_URL: ${DEFAULT_MODEL_URL:-<not set>}"
echo "  SHOW_CONTROLS: ${SHOW_CONTROLS}"

# Execute the main command
exec "$@"
