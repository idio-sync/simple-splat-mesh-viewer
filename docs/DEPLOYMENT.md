# Production Deployment Guide

## Architecture Overview

```
                [Client Browser]
                      |
                [Cloudflare CDN]  (free tier, handles SSL, caches up to 512MB)
                 /           \
          [Viewer]         [Archive Storage]
     viewer.company.com    assets.company.com
      (Docker/nginx)        (Cloudflare R2)
            |
      [VPS $10-20/mo]
      Docker Compose
```

The viewer is a fully client-side static application. The production deployment challenge is serving the HTML/JS/CSS viewer alongside large binary archive files (.a3d/.a3z, 100-500MB each) with CDN caching, iframe embedding support, and SSL.

### Why This Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Compute | Single VPS + Docker Compose | Static files need zero autoscaling; $10-20/mo vs $50+/mo for managed containers |
| Storage | Cloudflare R2 | Zero egress fees. 500MB archives x many views = significant savings vs S3 ($0.09/GB) |
| CDN | Cloudflare Free | Caches files up to 512MB, includes SSL and DDoS protection |
| SSL | Cloudflare edge + Origin CA | 15-year certificate validity, zero renewal maintenance |

## Quick Start

### 1. Deploy the Viewer

```bash
# Clone and deploy
git clone <repo-url>
cd Vitrine3D

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Build and run
docker compose up -d
```

### 2. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_DOMAINS` | _(empty)_ | Comma-separated trusted external domains. Supports wildcards: `*.cdn.example.com` |
| `FRAME_ANCESTORS` | `'self'` | CSP frame-ancestors value. Set to `'self' https://company.com` for iframe embedding |
| `DEFAULT_ARCHIVE_URL` | _(empty)_ | Archive URL to auto-load on page open |
| `DEFAULT_SPLAT_URL` | _(empty)_ | Splat file URL to auto-load |
| `DEFAULT_MODEL_URL` | _(empty)_ | Model file URL to auto-load |
| `DEFAULT_POINTCLOUD_URL` | _(empty)_ | Point cloud URL to auto-load |
| `SHOW_CONTROLS` | `true` | Show/hide the controls panel |
| `LOD_BUDGET_SD` | `1000000` | Splat LOD budget (max splats per frame) for SD quality tier |
| `LOD_BUDGET_HD` | `5000000` | Splat LOD budget (max splats per frame) for HD quality tier |
| `ADMIN_ENABLED` | `false` | Enable admin panel and library. See [Admin Panel](#admin-panel) and [Library Panel](#library-panel) |
| `ADMIN_USER` | `admin` | Admin basic auth username |
| `ADMIN_PASS` | _(empty)_ | Admin basic auth password (required when ADMIN_ENABLED=true) |
| `MAX_UPLOAD_SIZE` | `1024` | Maximum upload size in MB |
| `DEFAULT_KIOSK_THEME` | _(empty)_ | Default theme for clean URL kiosk views (e.g., `editorial`). See [Clean Archive URLs](#clean-archive-urls) |

### 3. Docker Compose

```yaml
version: "3.8"
services:
  viewer:
    image: youruser/vitrine3d:latest
    restart: unless-stopped
    ports:
      - "80:80"
    environment:
      - ALLOWED_DOMAINS=assets.yourcompany.com
      - FRAME_ANCESTORS='self' https://yourcompany.com https://*.yourcompany.com
      - SHOW_CONTROLS=true
```

## Archive Storage (Cloudflare R2)

### Bucket Layout

```
yourcompany-scans/
  scans/{scan-id}/{scan-id}.a3d
```

### Upload (CLI)

```bash
# Upload an archive
aws s3 cp ./project-123.a3d s3://yourcompany-scans/scans/project-123/project-123.a3d \
  --endpoint-url https://ACCOUNT_ID.r2.cloudflarestorage.com \
  --content-type application/zip

# The viewer URL becomes:
# https://viewer.yourcompany.com/?archive=https://assets.yourcompany.com/scans/project-123/project-123.a3d
```

### R2 CORS Configuration

Allow `GET` requests from your viewer domain with `Range` header support:

```json
[
  {
    "AllowedOrigins": ["https://viewer.yourcompany.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

### CDN Caching Strategy

| Content Type | Cache TTL | Rationale |
|-------------|-----------|-----------|
| HTML/JS/CSS (viewer) | 1 hour | Allows quick updates to viewer code |
| .a3d/.a3z archives | 30 days + immutable | Versioned by filename, never change in place |
| Thumbnails | 7 days | Moderate; can be regenerated |

### Disable Compression for Archive Files

**Important:** Cloudflare's automatic compression (Brotli/Gzip) must be disabled for directories serving `.a3d`/`.a3z` archive files. These files are already ZIP-compressed, and CDN re-compression corrupts the binary data when the viewer's streaming download assembles response chunks.

In the Cloudflare dashboard:

1. Go to **Rules → Compression Rules**
2. Create a rule:
   - **When:** URI Path starts with your archive directory (e.g., `/content/3d/`)
   - **Then:** Set compression to **Disabled**

This applies to any origin serving archives (Ghost, R2 public buckets, nginx, etc.). The viewer uses `ReadableStream` to track download progress, and CDN compression layers interfere with manual chunk assembly. Without this rule, archives will fail to load with `"invalid distance"` decompression errors.

## Iframe Embedding

Embed the viewer on your company website using existing URL parameters:

```html
<iframe
  src="https://viewer.yourcompany.com/?archive=https://assets.yourcompany.com/scans/project.a3d&controls=minimal&sidebar=view"
  width="100%" height="600" frameborder="0" allow="fullscreen">
</iframe>
```

### URL Parameters for Embedding

| Parameter | Values | Description |
|-----------|--------|-------------|
| `archive` | URL | Archive file to load |
| `kiosk` | `true` | Kiosk mode (read-only, simplified UI) |
| `controls` | `full`, `minimal`, `none` | Control panel visibility |
| `mode` | `splat`, `model`, `pointcloud`, `both`, `split` | Initial display mode |
| `toolbar` | `show`, `hide` | Toolbar visibility |
| `sidebar` | `closed`, `view`, `edit` | Metadata sidebar state |
| `theme` | theme folder name | Kiosk theme (e.g., `editorial`, `minimal`) |
| `layout` | `sidebar`, `editorial` | Layout override (overrides theme default) |
| `autoload` | `true`, `false` | Auto-load archive (default `true`; `false` shows click-to-load gate) |

### Required Configuration

Set the `FRAME_ANCESTORS` environment variable to include your company's domain:

```
FRAME_ANCESTORS='self' https://yourcompany.com https://*.yourcompany.com
```

## Social Link Previews & oEmbed

When a Vitrine3D viewer URL is shared on Slack, Discord, Twitter/X, Facebook, LinkedIn, or embedded in WordPress, the container can serve rich link previews with title, description, and thumbnail.

### How It Works

Two mechanisms are supported:

1. **Open Graph / Twitter Card meta tags** — When a bot/crawler requests a page, nginx detects it by user-agent and proxies the request to a lightweight Node.js meta-server running inside the container. The meta-server reads pre-extracted archive metadata and returns HTML with `og:title`, `og:description`, `og:image`, and Twitter Card tags. Human visitors are unaffected — they get the normal SPA.

2. **oEmbed** — A `/oembed` endpoint returns JSON per the [oEmbed spec](https://oembed.com/), enabling WordPress and other oEmbed consumers to embed an interactive 3D viewer iframe inline. The iframe uses `autoload=false` so users see the archive thumbnail as a click-to-load poster (like YouTube/Sketchfab).

### Enabling Link Previews

Set `OG_ENABLED=true` and `SITE_URL` in your environment:

```yaml
services:
  viewer:
    image: youruser/vitrine3d:latest
    restart: unless-stopped
    ports:
      - "80:80"
    environment:
      - OG_ENABLED=true
      - SITE_URL=https://viewer.yourcompany.com
      - SITE_NAME=Your Company 3D Viewer
      - SITE_DESCRIPTION=Interactive 3D scan viewer
      - OEMBED_WIDTH=960
      - OEMBED_HEIGHT=540
    volumes:
      # Mount archives directory for serving and auto-metadata extraction
      - ./archives:/usr/share/nginx/html/archives:ro
      # Mount a default thumbnail for archives without previews
      - ./thumbs/default.jpg:/usr/share/nginx/html/thumbs/default.jpg:ro
```

### Archive Directory

Archives (`.a3d`/`.a3z` files) must be accessible inside the container for both serving and metadata extraction. Mount your archives directory to `/usr/share/nginx/html/archives/` (or any subdirectory under the document root):

```bash
docker run -v /path/to/archives:/usr/share/nginx/html/archives:ro ...
```

The viewer URL becomes:
```
https://viewer.yourcompany.com/?archive=/archives/scan.a3d
```

On startup, the entrypoint scans the entire document root recursively for `.a3d`/`.a3z` files and extracts metadata into `/meta/` and thumbnails into `/thumbs/`. Subdirectory structure is preserved in the URL path — for example, `/archives/clients/project-123/scan.a3d` works as-is.

**Note:** If your archives are hosted externally (e.g., Cloudflare R2), the auto-extraction cannot read them. In that case, run `extract-meta.sh` manually against local copies and mount the resulting `/meta/` and `/thumbs/` directories:

```yaml
volumes:
  - ./meta:/usr/share/nginx/html/meta:ro
  - ./thumbs:/usr/share/nginx/html/thumbs:ro
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OG_ENABLED` | `false` | Master switch — existing deploys completely unaffected |
| `SITE_URL` | _(empty, required)_ | Canonical viewer URL (e.g., `https://viewer.yourcompany.com`). Required for absolute OG/oEmbed URLs |
| `SITE_NAME` | `Vitrine3D` | Used in `og:site_name` and oEmbed `provider_name` |
| `SITE_DESCRIPTION` | `Interactive 3D viewer` | Fallback description when an archive has none |
| `OEMBED_WIDTH` | `960` | Default iframe width in oEmbed responses |
| `OEMBED_HEIGHT` | `540` | Default iframe height in oEmbed responses |

### Default Thumbnail

The operator must provide a default thumbnail image for archives that don't have an embedded preview. Mount it as a Docker volume:

```bash
docker run -v /path/to/your/default.jpg:/usr/share/nginx/html/thumbs/default.jpg:ro ...
```

Recommended: 1200x630px JPEG (the optimal size for Open Graph images). If no default thumbnail is provided, link previews for archives without embedded thumbnails will have no image.

### Automatic Metadata Extraction

On container startup (when `OG_ENABLED=true`), the entrypoint automatically scans for `.a3d`/`.a3z` files and extracts:
- **Title and description** from the archive's `manifest.json`
- **Thumbnail** (`preview.jpg` or `thumbnail_0.png`) to `/thumbs/`
- **Metadata sidecar** JSON to `/meta/`

Extraction is idempotent — already-extracted archives are skipped. If you add new archives, restart the container to re-scan.

### WordPress oEmbed

WordPress automatically discovers oEmbed endpoints via the `<link rel="alternate" type="application/json+oembed">` tag in the bot-facing HTML. When a user pastes a Vitrine3D URL into a WordPress post:

1. WordPress fetches the page, finds the oEmbed discovery tag
2. Fetches `/oembed?url=...` and gets back JSON with `type: "rich"` and an iframe HTML snippet
3. Renders the iframe inline in the post — showing the click-to-load poster with the archive thumbnail

The oEmbed endpoint is accessible at:
```
https://viewer.yourcompany.com/oembed?url=https://viewer.yourcompany.com/?archive=/archives/scan.a3d&format=json
```

### Supported Crawlers

Bot detection covers: Googlebot, Bingbot, Slackbot, Twitterbot, Facebook, LinkedIn, Discord, WhatsApp, Applebot, iframely, Embedly, Pinterest, Reddit, Telegram, Viber, Skype, Tumblr, VK, and WordPress.

Unknown bots get the normal SPA (safe default — they just won't see rich previews).

### Verifying It Works

```bash
# Test OG tags (simulate Slackbot)
curl -H "User-Agent: Slackbot" "https://viewer.yourcompany.com/?archive=/archives/scan.a3d"
# Should return HTML with og:title, og:image, og:description

# Test oEmbed endpoint
curl "https://viewer.yourcompany.com/oembed?url=https://viewer.yourcompany.com/?archive=/archives/scan.a3d&format=json"
# Should return JSON with type: "rich" and an iframe html field

# Facebook Sharing Debugger
# https://developers.facebook.com/tools/debug/

# Twitter Card Validator
# https://cards-dev.twitter.com/validator
```

## SSL / HTTPS

### HTTPS Required for SHA-256 Integrity Hashing

**Important:** The viewer uses WebGL exclusively for 3D rendering — WebGPU was evaluated but disabled due to stability issues. However, HTTPS is still required in production for a different reason: **SHA-256 integrity hashing uses the Web Crypto API (`SubtleCrypto`), which is only available in secure contexts.**

| Access Method | Secure Context? | SubtleCrypto (SHA-256) Available? |
|---------------|----------------|-----------------------------------|
| `https://example.com` | ✅ Yes | ✅ Yes |
| `http://localhost` | ✅ Yes (exception) | ✅ Yes |
| `http://127.0.0.1` | ✅ Yes (exception) | ✅ Yes |
| `http://hostname.lan` | ❌ No | ❌ No |
| `http://192.168.x.x` | ❌ No | ❌ No |

**What happens without HTTPS:**
- `SubtleCrypto` is unavailable, so archives are created without SHA-256 integrity data
- The UI shows a warning banner in the Integrity tab and a toast notification on page load
- All rendering and other features continue to work normally

**Production recommendation:** Always deploy with HTTPS to ensure SHA-256 integrity hashing works when creating archives.

### Option A: Cloudflare (Recommended)

1. Add your domain to Cloudflare
2. Point DNS to your VPS
3. Enable "Full (strict)" SSL mode
4. Generate an Origin CA certificate (15-year validity)
5. Install the origin cert on your VPS (or let Cloudflare handle edge SSL with HTTP origin)

### Option B: Caddy Reverse Proxy

Add a Caddy container to docker-compose for automatic Let's Encrypt:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
  viewer:
    # ... (expose: ["80"] instead of ports)

volumes:
  caddy_data:
```

## Admin Panel

The container includes an optional admin panel at `/admin` for browser-based archive management: upload, delete, rename, and a gallery view. Protected by HTTP basic auth. Enabling the admin panel also activates the [Library Panel](#library-panel) inside the main viewer.

### Enabling the Admin Panel

Set `ADMIN_ENABLED=true` and provide `ADMIN_PASS`:

```yaml
services:
  viewer:
    image: youruser/vitrine3d:latest
    restart: unless-stopped
    ports:
      - "80:80"
    environment:
      - ADMIN_ENABLED=true
      - ADMIN_USER=admin
      - ADMIN_PASS=your-secure-password
      - MAX_UPLOAD_SIZE=1024
      # Archives must be mounted read-write for upload/delete/rename
    volumes:
      - ./archives:/usr/share/nginx/html/archives:rw
```

**Important:** The archives volume must be mounted with `:rw` (not `:ro`) when the admin panel is enabled.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_ENABLED` | `false` | Master switch for admin panel |
| `ADMIN_USER` | `admin` | Basic auth username |
| `ADMIN_PASS` | _(required)_ | Basic auth password. Container refuses to start if not set when `ADMIN_ENABLED=true` |
| `MAX_UPLOAD_SIZE` | `1024` | Maximum upload size in MB |

### How It Works

- The admin panel is served by the same Node.js meta-server that handles OG/oEmbed
- nginx protects `/admin` and `/api/*` routes with HTTP basic auth (htpasswd generated at container start)
- Uploads are streamed to disk (no in-memory buffering) — supports files up to `MAX_UPLOAD_SIZE`
- After upload, `extract-meta.sh` runs automatically to generate metadata sidecars and thumbnails
- The admin panel works independently of OG/oEmbed (`ADMIN_ENABLED=true` alone starts the meta-server)

### API Endpoints

All API routes require basic auth and are proxied through nginx:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin` | Admin panel HTML page |
| `GET` | `/api/archives` | List all archives with metadata, sizes, thumbnails |
| `POST` | `/api/archives` | Upload new archive (multipart/form-data) |
| `DELETE` | `/api/archives/:hash` | Delete archive and sidecar files |
| `PATCH` | `/api/archives/:hash` | Rename archive (JSON body: `{"filename": "new-name.a3d"}`) |

### Security Notes

- **HTTPS required in production.** Basic auth sends credentials as base64 — always deploy behind TLS (Cloudflare, Caddy, or similar)
- Path traversal protection on all operations (uploads sanitized, deletes/renames resolved via hash lookup)
- Uploads validated: file extension check, size limit enforced by both nginx and Node.js
- The admin panel does not affect existing deployments — all features are opt-in via `ADMIN_ENABLED`

### Verifying It Works

```bash
# Test API (with basic auth)
curl -u admin:your-secure-password https://viewer.yourcompany.com/api/archives

# Upload an archive
curl -u admin:your-secure-password -F file=@scan.a3d https://viewer.yourcompany.com/api/archives

# Delete by hash (hash from the list response)
curl -u admin:your-secure-password -X DELETE https://viewer.yourcompany.com/api/archives/a1b2c3d4e5f6g7h8

# Rename
curl -u admin:your-secure-password -X PATCH \
  -H "Content-Type: application/json" \
  -d '{"filename":"new-name.a3d"}' \
  https://viewer.yourcompany.com/api/archives/a1b2c3d4e5f6g7h8
```

## Library Panel

When `ADMIN_ENABLED=true`, the main viewer app gains a built-in **Library panel** — an archive browser integrated directly into the 3D viewer's tool rail. This is separate from the standalone admin page at `/admin` and provides a more seamless workflow for managing archives without leaving the viewer.

### How It Works

- The logo button in the left tool rail becomes a **Library** button
- Clicking it switches the viewport to a gallery view of all archives on the server
- Archives are displayed as cards with thumbnails, titles, sizes, and dates
- A detail pane on the right shows asset contents and metadata field coverage
- Sorting by name, date, or size is supported

### Actions

| Action | Description |
|--------|-------------|
| **Single-click** | Select an archive to view its details |
| **Double-click** | Open the archive in the current editor session |
| **Open** | Load the selected archive in the editor |
| **View** | Open the archive in a new tab (kiosk mode via clean URL) |
| **Share** | Open the share dialog with the archive's URL pre-filled |
| **Copy URL** | Copy the archive's viewer URL to clipboard |
| **Rename** | Rename the archive file on the server |
| **Delete** | Permanently delete the archive and its sidecar files |

### Upload

The Library panel includes a drag-and-drop upload zone at the bottom. Drop `.a3d`/`.a3z` files or click to browse. Uploads show real-time progress and automatically extract metadata and thumbnails on completion.

### Authentication

The Library panel uses the same HTTP Basic Auth credentials as the admin panel (`ADMIN_USER`/`ADMIN_PASS`). On first access, if the API returns 401, a login form is displayed. Credentials are stored in memory for the session (not persisted).

### Save to Library

When `ADMIN_ENABLED=true`, a **Save to Library** button appears in the export panel. This uploads the current archive directly to the server's archive directory after export, without requiring a separate upload step.

### Relationship to Admin Panel

| Feature | Admin Page (`/admin`) | Library Panel (viewer) |
|---------|----------------------|----------------------|
| URL | `/admin` | Main viewer, Library tool button |
| Authentication | nginx basic auth prompt | In-app login form |
| Archive gallery | Standalone HTML page | Integrated into viewport |
| Upload | Drag-and-drop | Drag-and-drop |
| Share dialog | Built-in | Built-in (with QR codes) |
| 3D preview | Opens in new tab | Double-click to load in editor |
| API used | Same `/api/archives` REST API | Same `/api/archives` REST API |

Both interfaces use the same backend API and the same credentials. Choose whichever fits your workflow — the admin page for dedicated management, or the Library panel for quick access while working in the editor.

## Clean Archive URLs

When the meta-server is running (`OG_ENABLED=true` or `ADMIN_ENABLED=true`), archives can be accessed via clean URLs without query parameters:

```
https://viewer.yourcompany.com/view/a1b2c3d4e5f6g7h8
```

The 16-character hex hash is a truncated SHA-256 of the archive's URL path (e.g., `/archives/scan.a3d`). The meta-server resolves this hash to the actual archive file and serves `index.html` with the archive configuration injected server-side.

### Benefits

- **Shorter, cleaner URLs** — no `?archive=` query parameter visible
- **Better for sharing** — simpler to paste into chat, email, or social media
- **Kiosk mode by default** — clean URLs automatically use kiosk mode with `autoload=false` (click-to-load poster)
- **Theme support** — set `DEFAULT_KIOSK_THEME` to apply a default theme to all clean URL views

### How It Works

1. nginx proxies `/view/{hash}` requests to the meta-server
2. The meta-server looks up the archive by hash (via sidecar metadata or directory scan)
3. It serves `index.html` with a `<script>` tag injecting `window.__VITRINE_CLEAN_URL` containing the archive path, kiosk mode flag, and theme
4. `config.js` reads this injection and configures the viewer automatically

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_KIOSK_THEME` | _(empty)_ | Theme applied to all clean URL views (e.g., `editorial`, `museum`, `technical`) |

### Share Dialog Integration

The share dialog in both the Library panel and the main viewer generates clean URLs automatically when sharing in kiosk mode. If the archive has a known hash (from the library), the share URL uses `/view/{hash}` format. The dialog also generates QR codes and embed snippets using these clean URLs.

### Combined Deployment (Admin + OG + Kiosk Security)

```yaml
services:
  viewer:
    image: youruser/vitrine3d:latest
    restart: unless-stopped
    ports:
      - "80:80"
    environment:
      - ADMIN_ENABLED=true
      - ADMIN_USER=admin
      - ADMIN_PASS=${ADMIN_PASS}
      - MAX_UPLOAD_SIZE=1024
      - OG_ENABLED=true
      - SITE_URL=https://viewer.yourcompany.com
      - SITE_NAME=Your Company 3D Viewer
      - ALLOWED_DOMAINS=assets.yourcompany.com
      - FRAME_ANCESTORS='self' https://yourcompany.com
    volumes:
      - ./archives:/usr/share/nginx/html/archives:rw
      - ./thumbs/default.jpg:/usr/share/nginx/html/thumbs/default.jpg:ro
```

## Nginx Configuration

The Docker image includes nginx configured with:
- GZIP compression for text-based assets
- 1-day cache headers for static files
- CORS headers for cross-origin file loading
- Proper MIME types for `.a3d`, `.a3z` (`application/zip`) and `.e57` (`application/octet-stream`) files
- Content Security Policy and security headers

See [`docker/nginx.conf`](../docker/nginx.conf) for the full configuration.

## Security

This section consolidates all deployment-relevant security controls. For security-related code review history, see [`CODE_REVIEW.md`](reference/CODE_REVIEW.md) section 3. For future security roadmap items (digital signatures, JS SHA-256 fallback), see [`SHORTCOMINGS_AND_SOLUTIONS.md`](reference/SHORTCOMINGS_AND_SOLUTIONS.md) section 5.

### Content Security Policy (CSP)

Two layers of CSP are applied:

**1. Meta tag in `index.html` (lines 8–23)** — Controls script sources, style sources, connect targets, and other resource origins:

```
default-src 'self';
script-src 'self' https://esm.sh https://*.esm.sh https://sparkjs.dev <sha256-hashes> 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:;
connect-src 'self' https: blob: data:;
worker-src 'self' blob:;
font-src 'self';
media-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
```

- `'unsafe-eval'` is **required** for Spark.js WASM and the PLY parser. Do not remove it or splat rendering will break. If Spark.js adds support for `'wasm-unsafe-eval'` (a narrower permission), switch to that.
- Two inline scripts use `sha256-` hashes rather than `'unsafe-inline'` for script-src.
- `frame-ancestors` **cannot** be set via meta tags — it must be set via HTTP headers (see below).

**2. nginx HTTP header (`nginx.conf.template` line 59)** — Controls iframe embedding:

```nginx
add_header Content-Security-Policy "frame-ancestors ${FRAME_ANCESTORS}" always;
```

Configured via the `FRAME_ANCESTORS` environment variable (default: `'self'`). Set this to include your company's domain when embedding in iframes:

```
FRAME_ANCESTORS='self' https://yourcompany.com https://*.yourcompany.com
```

### URL Validation & Domain Allowlisting

All externally-loaded URLs are validated before use. By default, only same-origin URLs are permitted.

**How it works:**
1. Parses the URL using the `URL` constructor (normalizes path traversal)
2. Blocks dangerous protocols (`javascript:`, `data:`, `vbscript:`, etc.) — only `http:` and `https:` are allowed
3. Checks if the URL is same-origin or matches the domain allowlist
4. Enforces HTTPS for external URLs when the viewer is served over HTTPS

**Configuring allowed external domains:**

For Docker deployments, set the `ALLOWED_DOMAINS` environment variable:

```bash
docker run -e ALLOWED_DOMAINS="assets.yourcompany.com,*.cdn.example.com" ...
```

Wildcard subdomains are supported (e.g., `*.cdn.example.com` matches `a.cdn.example.com` and `b.cdn.example.com`).

For local development, edit the `ALLOWED_EXTERNAL_DOMAINS` array in `src/config.js`:

```javascript
const ALLOWED_EXTERNAL_DOMAINS = [
    'trusted-cdn.example.com',
    '*.mycompany.com',
];
```

**Important: URL validation is implemented in two places** with separate domain allowlists:
- `config.js` (line 56) — validates URL parameters at boot
- `main.js` (line 157) — validates URLs entered via prompt dialogs

In Docker deployments, both share the list from `ALLOWED_DOMAINS` because `config.js.template` merges the env var into `ALLOWED_EXTERNAL_DOMAINS` and passes it to `main.js` via `window.APP_CONFIG.allowedDomains`. In local development, `main.js` reads from `APP_CONFIG` as well, but if you hardcode domains directly into `config.js`, `main.js` must also be updated.

### Archive Filename Sanitization

When extracting files from `.a3d`/`.a3z` archives, all filenames are sanitized by `sanitizeArchiveFilename()` in `archive-loader.js` (lines 37–99). This prevents:

| Attack | Protection |
|--------|-----------|
| Path traversal (`../../../etc/passwd`) | Blocks `..` sequences, strips leading slashes, normalizes URL-encoded variants |
| Null byte injection (`file%00.exe`) | Blocks null bytes |
| Double-encoding (`%252e%252e/`) | Decodes then re-checks for traversal sequences |
| Hidden files (`.bashrc`) | Blocks filenames starting with `.` |
| Invalid characters | Only allows `[a-zA-Z0-9_\-\.\/]` |
| Filename-based DoS | Rejects filenames longer than 255 characters |

This function is security-critical and currently has no automated test coverage.

### Kiosk Embed Security

When embedding the viewer via `<iframe>` on client websites, four environment variables lock down the viewer:

| Variable | Example | Description |
|----------|---------|-------------|
| `KIOSK_LOCK` | `true` | Forces kiosk mode server-side. Ignores privilege-escalating URL params (`?kiosk`, `?controls`, `?sidebar`, `?toolbar`, `?splat`, `?model`, `?pointcloud`, `?alignment`). The `?archive=` param still works (needed for per-embed URLs). Theme/layout params are allowed (cosmetic only). |
| `ARCHIVE_PATH_PREFIX` | `/archives/` | When set with `KIOSK_LOCK`, only allows loading archives whose path starts with this prefix. Prevents path traversal (`../`) via URL normalization using `new URL()`. New archives added to the directory work immediately with no config changes. |
| `EMBED_REFERERS` | `client.com *.client.com` | nginx `valid_referers` check. Rejects requests from unlisted domains. Direct browser visits (no referer) are still allowed. Space-separated list; supports wildcards. |
| `FRAME_ANCESTORS` | `https://client.com` | CSP `frame-ancestors` directive set via nginx HTTP header. Prevents the viewer from being embedded in iframes on unauthorized sites (clickjacking prevention). |

**Example deployment:**

```bash
docker run -e KIOSK_LOCK=true \
           -e ARCHIVE_PATH_PREFIX="/archives/" \
           -e FRAME_ANCESTORS="https://client-website.com" \
           -e EMBED_REFERERS="client-website.com *.client-website.com" \
           -v /path/to/archives:/usr/share/nginx/html/archives \
           viewer:latest
```

```html
<iframe src="https://viewer.example.com?archive=/archives/a8f3e2b1-4c5d/scan.a3d&autoload=false"></iframe>
```

**Security layers:**

| Layer | What It Prevents |
|-------|-----------------|
| `KIOSK_LOCK` | Switching to editor mode via URL params |
| `ARCHIVE_PATH_PREFIX` | Loading files outside the archives directory |
| nginx module blocking | Loading editor JS modules (`archive-creator`, `share-dialog`, `kiosk-viewer`) even via devtools |
| `EMBED_REFERERS` | Accessing the viewer from unlisted domains |
| `FRAME_ANCESTORS` | Embedding the viewer iframe on unauthorized sites |
| Non-guessable paths | Guessing other clients' archive URLs |

**Recommended: non-guessable archive paths.** Use UUID-based directory names instead of predictable names:

```
/archives/a8f3e2b1-4c5d-9876-abcd-1234567890ef/scan.a3d   (good)
/archives/client-name/scan.a3d                              (bad — guessable)
```

**Threat model:** Archives are served as static files. Anyone who knows the direct URL can download the raw `.a3d` file regardless of viewer UI restrictions. The lockdown controls the **UI experience** only. For true per-file access control, use non-guessable UUID paths. If stronger access control is needed (time-limited access, per-user authentication), consider signed URLs with expiry or UUID aliasing — see the [Admin Panel](#admin-panel) section.

When all kiosk embed env vars are unset, the viewer behaves exactly as before (zero breaking changes).

### CORS Configuration

nginx serves CORS headers for cross-origin file loading. The relevant headers are configured in `nginx.conf.template`:

```nginx
# Global CORS headers
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Methods "GET, OPTIONS";
add_header Access-Control-Allow-Headers "Origin, Content-Type, Accept";

# Archive and E57 files additionally allow Range header (for partial downloads / click-to-load gate)
add_header Access-Control-Allow-Headers "Origin, Content-Type, Accept, Range";
```

For Cloudflare R2 storage, the bucket also needs CORS configured — see [R2 CORS Configuration](#r2-cors-configuration) above.

### nginx Security Headers

The Docker production config (`nginx.conf.template`) sets these security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `frame-ancestors ${FRAME_ANCESTORS}` | Prevents clickjacking by controlling which origins can embed the viewer in an iframe |
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing responses away from the declared content type |

The local development config (`nginx.conf`) additionally sets `X-Frame-Options: SAMEORIGIN` as a legacy fallback for older browsers. The production template omits this because `frame-ancestors` is the modern replacement and the value needs to be configurable.

### Integrity Hashing (SHA-256)

Archives include SHA-256 hashes for all contained files, computed via the Web Crypto API (`SubtleCrypto`). The hash for each asset and a manifest hash (computed from sorted asset hashes) are stored in the manifest's `integrity` section:

```json
"integrity": {
    "algorithm": "SHA-256",
    "manifest_hash": "a1b2c3...",
    "assets": { "assets/mesh.glb": "d4e5f6...", ... }
}
```

**HTTPS requirement:** `SubtleCrypto` requires a secure context (HTTPS). On HTTP deployments (common in development), hashing is unavailable and archives are created without integrity data. The UI shows:
- A warning banner in the Integrity tab
- A toast notification on page load

For production deployments, **always serve over HTTPS** to ensure integrity hashing works. See [SSL / HTTPS](#ssl--https) above.

**Limitation:** SHA-256 hashes detect accidental corruption but not intentional tampering. There are no digital signatures. For future work on cryptographic signing, see [`SHORTCOMINGS_AND_SOLUTIONS.md`](reference/SHORTCOMINGS_AND_SOLUTIONS.md) section 5.1.

### Known Security Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| `'unsafe-eval'` in CSP | Weakens XSS protections for the entire page | Required for Spark.js WASM. Switch to `'wasm-unsafe-eval'` when Spark.js supports it. |
| No digital signatures | SHA-256 detects corruption but not tampering | Planned: ECDSA signing via Web Crypto API (see [SHORTCOMINGS_AND_SOLUTIONS.md](reference/SHORTCOMINGS_AND_SOLUTIONS.md) section 5.1) |
| No rate limiting on file operations | No protection against resource exhaustion from large files | Planned: file size limits (see [ROADMAP.md](ROADMAP.md)) |
| No point cloud size limits | Large E57 files can exhaust browser memory | Planned: file size warnings for assets >100 MB |
| SHA-256 unavailable on HTTP | Archives created over HTTP have no integrity data | Deploy over HTTPS in production |
| Archive sanitization has no tests | Security-critical code without automated verification | Planned: testing framework (see [ROADMAP.md](ROADMAP.md)) |
