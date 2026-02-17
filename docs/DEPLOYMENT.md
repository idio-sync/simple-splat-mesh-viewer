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
| `DEFAULT_ALIGNMENT_URL` | _(empty)_ | Alignment JSON URL to auto-load |
| `SHOW_CONTROLS` | `true` | Show/hide the controls panel |

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

## SSL / HTTPS

### WebGPU Requires Secure Contexts

**Important:** The viewer uses WebGPU for high-performance rendering when available. WebGPU is a browser security feature that **requires a secure context** (HTTPS) to function:

| Access Method | Secure Context? | WebGPU Available? |
|---------------|----------------|-------------------|
| `https://example.com` | ✅ Yes | ✅ Yes |
| `http://localhost` | ✅ Yes (exception) | ✅ Yes |
| `http://127.0.0.1` | ✅ Yes (exception) | ✅ Yes |
| `http://hostname.lan` | ❌ No | ❌ No |
| `http://192.168.x.x` | ❌ No | ❌ No |

**What happens without HTTPS:**
- On non-secure contexts, the viewer automatically falls back to WebGL rendering
- You'll see a console warning: `WebGPU initialization failed, falling back to WebGL`
- Performance is slightly reduced (WebGL vs WebGPU) but all features work

**Production recommendation:** Always deploy with HTTPS to enable WebGPU rendering for best performance.

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

## Future: Admin Panel

The viewer is stateless by design. Add an admin panel as a **separate service** in docker-compose:

```
[Admin Panel]  ------>  [Object Storage (R2)]
  (Node/Go)                    |
     |                   [CDN (Cloudflare)]
     |                         |
[SQLite DB]              [Viewer (unchanged)]
```

- **Phase 1 (now):** CLI uploads, viewer reads archives via URL params
- **Phase 2:** Admin panel manages upload, metadata, embed code generation
- **Phase 3:** Presigned R2 URLs with expiry for access control (no viewer changes needed -- the signed URL IS the authorization)

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

**Threat model:** Archives are served as static files. Anyone who knows the direct URL can download the raw `.a3d` file regardless of viewer UI restrictions. The lockdown controls the **UI experience** only. For true per-file access control, use non-guessable UUID paths. If stronger access control is needed (time-limited access, per-user authentication), a backend signing service would be required — see the [Future: Admin Panel](#future-admin-panel) section on presigned R2 URLs.

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
