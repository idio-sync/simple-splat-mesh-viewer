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
cd simple-splat-mesh-viewer

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
    image: youruser/splat-mesh-compare:latest
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
| `mode` | `splat`, `model`, `both`, `split` | Initial display mode |
| `toolbar` | `show`, `hide` | Toolbar visibility |
| `sidebar` | `closed`, `view`, `edit` | Metadata sidebar state |

### Required Configuration

Set the `FRAME_ANCESTORS` environment variable to include your company's domain:

```
FRAME_ANCESTORS='self' https://yourcompany.com https://*.yourcompany.com
```

## SSL / HTTPS

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

## Migrating from Sketchfab

**Phase 1 (Weeks 1-4):** Deploy self-hosted viewer. Upload existing scans as .a3d archives. Run both Sketchfab and self-hosted in parallel.

**Phase 2 (Weeks 4-8):** Replace Sketchfab iframe embeds on your website with self-hosted viewer URLs. Send clients updated direct links.

**Phase 3 (Week 8+):** Remove scans from Sketchfab. Cancel subscription.

> **Note:** Sketchfab URLs cannot be redirected (you don't control `sketchfab.com`). Any client-bookmarked Sketchfab links will break after removal. Proactively send new links.

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

## Security Notes

- URL validation prevents loading from untrusted domains (configured via `ALLOWED_DOMAINS`)
- CSP `frame-ancestors` prevents clickjacking (configured via `FRAME_ANCESTORS`)
- HTTPS enforced for external URLs when viewer is served over HTTPS
- Archives served as `application/zip` with CORS headers
- `X-Content-Type-Options: nosniff` prevents MIME sniffing
