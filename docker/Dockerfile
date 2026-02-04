FROM nginx:alpine

# Install envsubst for environment variable substitution
RUN apk add --no-cache gettext

# Create modules directory
RUN mkdir -p /usr/share/nginx/html/modules

# Copy nginx configuration
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

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
COPY src/modules/share-dialog.js /usr/share/nginx/html/modules/

# Copy the config template and entrypoint script
COPY docker/config.js.template /usr/share/nginx/html/config.js.template
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment variables with defaults
ENV DEFAULT_ARCHIVE_URL=""
ENV DEFAULT_SPLAT_URL=""
ENV DEFAULT_MODEL_URL=""
ENV DEFAULT_ALIGNMENT_URL=""
ENV SHOW_CONTROLS="true"

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
