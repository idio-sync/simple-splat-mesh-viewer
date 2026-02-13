FROM nginx:alpine

# Install envsubst for environment variable substitution
RUN apk add --no-cache gettext

# Create modules directory
RUN mkdir -p /usr/share/nginx/html/modules

# Copy nginx configuration template (processed by entrypoint)
COPY docker/nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Copy main application files from src/
COPY src/index.html /usr/share/nginx/html/
COPY src/styles.css /usr/share/nginx/html/
COPY src/main.js /usr/share/nginx/html/
COPY src/pre-module.js /usr/share/nginx/html/
COPY src/config.js /usr/share/nginx/html/

# Copy JavaScript modules from src/modules/
COPY src/modules/constants.js /usr/share/nginx/html/modules/
COPY src/modules/utilities.js /usr/share/nginx/html/modules/
COPY src/modules/alignment.js /usr/share/nginx/html/modules/
COPY src/modules/ui-controller.js /usr/share/nginx/html/modules/
COPY src/modules/metadata-manager.js /usr/share/nginx/html/modules/
COPY src/modules/file-handlers.js /usr/share/nginx/html/modules/
COPY src/modules/scene-manager.js /usr/share/nginx/html/modules/
COPY src/modules/archive-loader.js /usr/share/nginx/html/modules/
COPY src/modules/archive-creator.js /usr/share/nginx/html/modules/
COPY src/modules/annotation-system.js /usr/share/nginx/html/modules/
COPY src/modules/annotation-controller.js /usr/share/nginx/html/modules/
COPY src/modules/share-dialog.js /usr/share/nginx/html/modules/
COPY src/modules/fly-controls.js /usr/share/nginx/html/modules/
COPY src/modules/kiosk-viewer.js /usr/share/nginx/html/modules/
COPY src/modules/kiosk-main.js /usr/share/nginx/html/modules/
COPY src/modules/theme-loader.js /usr/share/nginx/html/modules/

# Copy theme files
COPY src/themes/ /usr/share/nginx/html/themes/

# Copy the config template and entrypoint script
COPY docker/config.js.template /usr/share/nginx/html/config.js.template
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables with defaults
ENV DEFAULT_ARCHIVE_URL=""
ENV DEFAULT_SPLAT_URL=""
ENV DEFAULT_MODEL_URL=""
ENV DEFAULT_POINTCLOUD_URL=""
ENV DEFAULT_ALIGNMENT_URL=""
ENV SHOW_CONTROLS="true"
ENV ALLOWED_DOMAINS=""
ENV FRAME_ANCESTORS="'self'"

# Kiosk embed security (see docs/KIOSK-VIEWER.md for details)
ENV KIOSK_LOCK=""
ENV ARCHIVE_PATH_PREFIX=""
ENV EMBED_REFERERS=""

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
