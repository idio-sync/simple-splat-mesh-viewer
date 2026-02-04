FROM nginx:alpine

# Install envsubst for environment variable substitution
RUN apk add --no-cache gettext

# Copy application files
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all JavaScript files
COPY main.js /usr/share/nginx/html/
COPY pre-module.js /usr/share/nginx/html/
COPY config.js /usr/share/nginx/html/
COPY constants.js /usr/share/nginx/html/
COPY utilities.js /usr/share/nginx/html/
COPY alignment.js /usr/share/nginx/html/
COPY ui-controller.js /usr/share/nginx/html/
COPY metadata-manager.js /usr/share/nginx/html/
COPY file-handlers.js /usr/share/nginx/html/
COPY scene-manager.js /usr/share/nginx/html/
COPY archive-loader.js /usr/share/nginx/html/
COPY archive-creator.js /usr/share/nginx/html/
COPY annotation-system.js /usr/share/nginx/html/

# Copy the config template and entrypoint script
COPY config.js.template /usr/share/nginx/html/config.js.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
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
