FROM nginx:alpine

# Install envsubst for environment variable substitution,
# Node.js for the OG/oEmbed meta-server,
# python3 for metadata extraction JSON parsing,
# and unzip for reading archive contents
RUN apk add --no-cache gettext nodejs python3 unzip

# Copy nginx configuration template (processed by entrypoint)
COPY docker/nginx.conf.template /etc/nginx/templates/nginx.conf.template

# Copy Vite build output (run "npm run build" before "docker build")
COPY dist/ /usr/share/nginx/html/

# Copy the config template and entrypoint script
# (entrypoint runs envsubst to generate config.js from template at container start)
COPY docker/config.js.template /usr/share/nginx/html/config.js.template
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy OG/oEmbed meta-server, admin panel, and metadata extraction script
COPY docker/meta-server.js /opt/meta-server.js
COPY docker/admin.html /opt/admin.html
COPY docker/extract-meta.sh /opt/extract-meta.sh
RUN chmod +x /opt/extract-meta.sh

# Create directories for extracted metadata and thumbnails
# Operators can mount /usr/share/nginx/html/thumbs/ for custom default thumbnail
RUN mkdir -p /usr/share/nginx/html/meta /usr/share/nginx/html/thumbs

# Environment variables with defaults
ENV DEFAULT_ARCHIVE_URL=""
ENV DEFAULT_SPLAT_URL=""
ENV DEFAULT_MODEL_URL=""
ENV DEFAULT_POINTCLOUD_URL=""
ENV SHOW_CONTROLS="true"
ENV ALLOWED_DOMAINS=""
ENV FRAME_ANCESTORS="'self'"

# Kiosk embed security (see docs/DEPLOYMENT.md#kiosk-embed-security for details)
ENV KIOSK_LOCK=""
ENV ARCHIVE_PATH_PREFIX=""
ENV EMBED_REFERERS=""

# OG/oEmbed link preview support (see docs/DEPLOYMENT.md#social-link-previews--oembed)
ENV OG_ENABLED="false"
ENV SITE_NAME="Vitrine3D"
ENV SITE_URL=""
ENV SITE_DESCRIPTION="Interactive 3D viewer"
ENV OEMBED_WIDTH="960"
ENV OEMBED_HEIGHT="540"

# Admin panel (see docs/DEPLOYMENT.md#admin-panel)
ENV ADMIN_ENABLED="false"
ENV ADMIN_USER="admin"
ENV ADMIN_PASS=""
ENV MAX_UPLOAD_SIZE="1024"

# Clean URL defaults (see docs/DEPLOYMENT.md#clean-archive-urls)
ENV DEFAULT_KIOSK_THEME=""

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
