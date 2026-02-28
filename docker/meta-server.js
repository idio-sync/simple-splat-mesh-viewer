#!/usr/bin/env node
'use strict';

/**
 * meta-server.js — Lightweight OG/oEmbed metadata server + Admin API for Vitrine3D
 *
 * Runs alongside nginx inside the Docker container. Zero npm dependencies.
 *
 * OG/oEmbed routes (always active when server is running):
 *   GET / (bot user-agent)  → HTML with OG + Twitter Card meta tags
 *   GET /oembed              → oEmbed JSON response
 *   GET /health              → 200 OK
 *
 * Admin routes (active when ADMIN_ENABLED=true):
 *   GET  /admin              → Admin panel HTML page
 *   GET  /api/archives       → List all archives with metadata
 *   POST /api/archives       → Upload new archive (multipart/form-data, streamed)
 *   DELETE /api/archives/:hash → Delete archive + sidecar files
 *   PATCH  /api/archives/:hash → Rename archive
 *
 * Reads pre-extracted metadata from /usr/share/nginx/html/meta/{hash}.json
 * and serves thumbnails from /usr/share/nginx/html/thumbs/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { execSync } = require('child_process');

// --- Configuration from environment ---

const PORT = parseInt(process.env.META_PORT || '3001', 10);
const SITE_NAME = process.env.SITE_NAME || 'Vitrine3D';
const SITE_URL = process.env.SITE_URL || '';
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || 'Interactive 3D viewer';
const OEMBED_WIDTH = parseInt(process.env.OEMBED_WIDTH || '960', 10);
const OEMBED_HEIGHT = parseInt(process.env.OEMBED_HEIGHT || '540', 10);
const ADMIN_ENABLED = process.env.ADMIN_ENABLED === 'true';
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || '1024', 10) * 1024 * 1024;
const CHUNKED_UPLOAD = process.env.CHUNKED_UPLOAD === 'true';
const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB per-chunk hard cap
const CHUNKS_DIR = '/tmp/v3d_chunks';
const DEFAULT_KIOSK_THEME = process.env.DEFAULT_KIOSK_THEME || '';

const HTML_ROOT = '/usr/share/nginx/html';
const META_DIR = path.join(HTML_ROOT, 'meta');
const THUMBS_DIR = path.join(HTML_ROOT, 'thumbs');
const ARCHIVES_DIR = path.join(HTML_ROOT, 'archives');
const UUID_INDEX_PATH = path.join(META_DIR, '_uuid-index.json');

// Admin HTML (loaded at startup if enabled)
const ADMIN_HTML = ADMIN_ENABLED ? (() => {
    try { return fs.readFileSync('/opt/admin.html', 'utf8'); }
    catch { return '<html><body><h1>Admin page not found</h1></body></html>'; }
})() : '';

// Index HTML (lazy-loaded for clean /view/ URLs)
let _indexHtml = null;
function getIndexHtml() {
    if (_indexHtml === null) {
        try { _indexHtml = fs.readFileSync(path.join(HTML_ROOT, 'index.html'), 'utf8'); }
        catch { _indexHtml = ''; }
    }
    return _indexHtml;
}

// --- Helpers ---

/**
 * Deterministic hash for an archive URL path.
 * Used to map archive URLs to their sidecar metadata files.
 */
function archiveHash(archiveUrl) {
    return crypto.createHash('sha256').update(archiveUrl).digest('hex').slice(0, 16);
}

/**
 * Read and parse a JSON metadata sidecar file for an archive.
 * Returns null if the file doesn't exist or is invalid.
 */
function readMeta(archiveUrl) {
    if (!archiveUrl) return null;
    const hash = archiveHash(archiveUrl);
    const metaPath = path.join(META_DIR, hash + '.json');
    try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Resolve the thumbnail URL for an archive.
 * Falls back to default thumbnail if archive-specific one doesn't exist.
 */
function thumbnailUrl(meta, archiveUrl) {
    if (meta && meta.thumbnail) {
        return SITE_URL + meta.thumbnail;
    }
    // Check if a hash-based thumbnail exists
    if (archiveUrl) {
        const hash = archiveHash(archiveUrl);
        const thumbPath = path.join(THUMBS_DIR, hash + '.jpg');
        if (fs.existsSync(thumbPath)) {
            return SITE_URL + '/thumbs/' + hash + '.jpg';
        }
    }
    // Fall back to operator-provided default
    const defaultThumb = path.join(THUMBS_DIR, 'default.jpg');
    if (fs.existsSync(defaultThumb)) {
        return SITE_URL + '/thumbs/default.jpg';
    }
    return '';
}

/**
 * Extract the ?archive= parameter from a full viewer URL.
 */
function extractArchiveParam(viewerUrl) {
    try {
        const parsed = new URL(viewerUrl);
        return parsed.searchParams.get('archive') || '';
    } catch {
        return '';
    }
}

/**
 * Escape HTML entities to prevent XSS in meta tag values.
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Check if a request is from a known bot/crawler.
 * Mirrors the $is_bot user-agent map in nginx.conf.template.
 */
const BOT_UA_RE = /googlebot|bingbot|slackbot|twitterbot|facebookexternalhit|linkedinbot|discordbot|whatsapp|applebot|iframely|embedly|pinterest|redditbot|telegrambot|viber|skypeuripreview|tumblr|vkshare|wordpress/i;

function isBotRequest(req) {
    return BOT_UA_RE.test(req.headers['user-agent'] || '');
}

/**
 * Write an OG/Twitter Card HTML response.
 * Shared by handleBotRequest (query-param URLs) and handleView* (clean URLs).
 */
function serveOgHtml(res, title, description, thumb, canonicalUrl, oembedUrl) {
    const t = escapeHtml(title);
    const d = escapeHtml(description);
    const u = escapeHtml(canonicalUrl);
    const oe = escapeHtml(oembedUrl);
    const i = escapeHtml(thumb);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${t}</title>

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
    <meta property="og:title" content="${t}">
    <meta property="og:description" content="${d}">
    <meta property="og:url" content="${u}">
    ${i ? `<meta property="og:image" content="${i}">` : ''}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="${i ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${t}">
    <meta name="twitter:description" content="${d}">
    ${i ? `<meta name="twitter:image" content="${i}">` : ''}

    <!-- oEmbed discovery -->
    <link rel="alternate" type="application/json+oembed" href="${oe}" title="${t}">

    <!-- Redirect human visitors that somehow reach this page -->
    <meta http-equiv="refresh" content="0;url=${u}">
</head>
<body>
    <p>Redirecting to <a href="${u}">${t}</a>...</p>
</body>
</html>`;

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
    });
    res.end(html);
}

// --- UUID Index ---

function loadUuidIndex() {
    try { return JSON.parse(fs.readFileSync(UUID_INDEX_PATH, 'utf8')); }
    catch { return {}; }
}

function saveUuidIndex(index) {
    try {
        if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });
        fs.writeFileSync(UUID_INDEX_PATH, JSON.stringify(index, null, 2));
    } catch (err) {
        console.error('[meta-server] Failed to save UUID index:', err.message);
    }
}

/**
 * Get or create a stable UUID for an archive URL.
 * UUIDs are persisted in _uuid-index.json so they survive server restarts.
 */
function getOrCreateUuid(archiveUrl) {
    const index = loadUuidIndex();
    if (index[archiveUrl]) return index[archiveUrl];
    const uuid = crypto.randomUUID();
    index[archiveUrl] = uuid;
    saveUuidIndex(index);
    return uuid;
}

/**
 * Migrate a UUID from one archive URL to another (used on rename).
 */
function migrateUuid(oldArchiveUrl, newArchiveUrl) {
    const index = loadUuidIndex();
    const uuid = index[oldArchiveUrl];
    if (uuid) {
        delete index[oldArchiveUrl];
        index[newArchiveUrl] = uuid;
        saveUuidIndex(index);
    }
}

/**
 * Remove a UUID entry from the index (used on delete).
 */
function deleteUuidEntry(archiveUrl) {
    const index = loadUuidIndex();
    if (index[archiveUrl]) {
        delete index[archiveUrl];
        saveUuidIndex(index);
    }
}

/**
 * Find an archive by its UUID.
 */
function findArchiveByUuid(uuid) {
    const index = loadUuidIndex();
    const archiveUrl = Object.keys(index).find(k => index[k] === uuid);
    if (!archiveUrl) return null;
    return findArchiveByHash(archiveHash(archiveUrl));
}

// --- OG/oEmbed Route Handlers ---

/**
 * Generate HTML with OG + Twitter Card meta tags for bot crawlers.
 */
function handleBotRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const archiveUrl = parsed.query.archive || '';
    const meta = readMeta(archiveUrl);

    serveOgHtml(
        res,
        (meta && meta.title) || SITE_NAME,
        (meta && meta.description) || SITE_DESCRIPTION,
        thumbnailUrl(meta, archiveUrl),
        SITE_URL + (req.url || '/'),
        SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
    );
}

/**
 * Handle /oembed requests per the oEmbed specification.
 */
function handleOembed(req, res) {
    const parsed = url.parse(req.url, true);
    const viewerUrl = parsed.query.url || '';
    const format = parsed.query.format || 'json';

    if (format !== 'json') {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only JSON format is supported' }));
        return;
    }

    if (!viewerUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required "url" parameter' }));
        return;
    }

    let archiveUrl = extractArchiveParam(viewerUrl);
    let meta = readMeta(archiveUrl);

    // For clean /view/{uuid|hash} URLs there is no ?archive= param — look up by path
    if (!archiveUrl) {
        try {
            const parsedViewerUrl = new URL(viewerUrl);
            const uuidMatch = parsedViewerUrl.pathname.match(/^\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
            const hashMatch = parsedViewerUrl.pathname.match(/^\/view\/([a-f0-9]{16})$/);
            let found = null;
            if (uuidMatch) found = findArchiveByUuid(uuidMatch[1]);
            else if (hashMatch) found = findArchiveByHash(hashMatch[1]);
            if (found) {
                archiveUrl = '/archives/' + found.filename;
                meta = found.meta;
            }
        } catch { /* ignore invalid URL */ }
    }

    const title = (meta && meta.title) || SITE_NAME;
    const thumb = thumbnailUrl(meta, archiveUrl);

    // Build iframe embed URL with autoload=false for click-to-load gate
    const embedParams = new URLSearchParams();
    if (archiveUrl) embedParams.set('archive', archiveUrl);
    embedParams.set('kiosk', 'true');
    embedParams.set('controls', 'minimal');
    embedParams.set('autoload', 'false');
    const embedUrl = SITE_URL + '/?' + embedParams.toString();

    // Respect maxwidth/maxheight from consumer
    const maxWidth = parsed.query.maxwidth ? parseInt(parsed.query.maxwidth, 10) : null;
    const maxHeight = parsed.query.maxheight ? parseInt(parsed.query.maxheight, 10) : null;
    const width = maxWidth ? Math.min(OEMBED_WIDTH, maxWidth) : OEMBED_WIDTH;
    const height = maxHeight ? Math.min(OEMBED_HEIGHT, maxHeight) : OEMBED_HEIGHT;

    const response = {
        version: '1.0',
        type: 'rich',
        title: title,
        provider_name: SITE_NAME,
        provider_url: SITE_URL || undefined,
        width: width,
        height: height,
        html: `<iframe src="${embedUrl}" width="${width}" height="${height}" frameborder="0" allow="fullscreen" loading="lazy" style="border:0;border-radius:8px;"></iframe>`
    };

    if (thumb) {
        response.thumbnail_url = thumb;
        response.thumbnail_width = 512;
        response.thumbnail_height = 512;
    }

    res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(response));
}

/**
 * Health check endpoint.
 */
function handleHealth(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
}

// --- Admin Helpers ---

/**
 * Sanitize an uploaded filename to prevent path traversal and dangerous patterns.
 */
function sanitizeFilename(name) {
    // Strip directory components
    let clean = String(name).split(/[/\\]/).pop() || '';
    // Only allow safe characters
    clean = clean.replace(/[^a-zA-Z0-9_.\-() ]/g, '_');
    // Collapse multiple underscores/spaces
    clean = clean.replace(/_{2,}/g, '_').replace(/ {2,}/g, ' ').trim();
    // Must end with .a3d or .a3z
    if (!/\.(a3d|a3z)$/i.test(clean)) {
        clean += '.a3d';
    }
    // Reject empty, dot-only, or suspicious names
    if (!clean || /^\./.test(clean) || clean === '.a3d' || clean === '.a3z') {
        return 'archive_' + Date.now() + '.a3d';
    }
    // Limit length
    if (clean.length > 200) {
        const ext = clean.slice(clean.lastIndexOf('.'));
        clean = clean.slice(0, 200 - ext.length) + ext;
    }
    return clean;
}

/**
 * List all archives in the archives directory with their metadata.
 */
function listArchives() {
    const results = [];
    if (!fs.existsSync(ARCHIVES_DIR)) return results;

    let files;
    try { files = fs.readdirSync(ARCHIVES_DIR); }
    catch { return results; }

    for (const file of files) {
        if (!/\.(a3d|a3z)$/i.test(file)) continue;
        const filePath = path.join(ARCHIVES_DIR, file);
        let stat;
        try { stat = fs.statSync(filePath); }
        catch { continue; }
        if (!stat.isFile()) continue;

        const archiveUrl = '/archives/' + file;
        const hash = archiveHash(archiveUrl);
        const meta = readMeta(archiveUrl);

        results.push({
            hash,
            uuid: getOrCreateUuid(archiveUrl),
            filename: file,
            path: archiveUrl,
            title: (meta && meta.title) || file.replace(/\.(a3d|a3z)$/i, ''),
            description: (meta && meta.description) || '',
            thumbnail: thumbnailUrl(meta, archiveUrl),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            viewerUrl: '/?archive=' + encodeURIComponent(archiveUrl),
            assets: (meta && meta.assets) || [],
            metadataFields: (meta && meta.metadata_fields) || {}
        });
    }

    return results;
}

/**
 * Find an archive by its hash. Looks up the meta sidecar first, falls back to scanning.
 */
function findArchiveByHash(hash) {
    // Try meta sidecar lookup first
    const metaPath = path.join(META_DIR, hash + '.json');
    try {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const meta = JSON.parse(raw);
        if (meta.archive_url) {
            const filename = path.basename(meta.archive_url);
            const filePath = path.join(ARCHIVES_DIR, filename);
            if (fs.existsSync(filePath)) {
                return { meta, filename, filePath };
            }
        }
    } catch { /* fall through to scan */ }

    // Fallback: scan archives directory
    if (!fs.existsSync(ARCHIVES_DIR)) return null;
    let files;
    try { files = fs.readdirSync(ARCHIVES_DIR); }
    catch { return null; }

    for (const file of files) {
        if (!/\.(a3d|a3z)$/i.test(file)) continue;
        const archiveUrl = '/archives/' + file;
        if (archiveHash(archiveUrl) === hash) {
            return {
                meta: readMeta(archiveUrl),
                filename: file,
                filePath: path.join(ARCHIVES_DIR, file)
            };
        }
    }
    return null;
}

/**
 * Run extract-meta.sh on a single archive file to generate/regenerate sidecars.
 */
function runExtractMeta(absolutePath) {
    try {
        execSync(
            '/opt/extract-meta.sh "' + HTML_ROOT + '" "' + HTML_ROOT + '" "' + absolutePath + '"',
            { timeout: 30000, stdio: 'pipe' }
        );
    } catch (err) {
        console.error('[admin] extract-meta failed:', err.message);
    }
}

/**
 * Build a single archive JSON object from a file path.
 */
function buildArchiveObject(filename) {
    const filePath = path.join(ARCHIVES_DIR, filename);
    const stat = fs.statSync(filePath);
    const archiveUrl = '/archives/' + filename;
    const hash = archiveHash(archiveUrl);
    const meta = readMeta(archiveUrl);

    return {
        hash,
        uuid: getOrCreateUuid(archiveUrl),
        filename,
        path: archiveUrl,
        title: (meta && meta.title) || filename.replace(/\.(a3d|a3z)$/i, ''),
        description: (meta && meta.description) || '',
        thumbnail: thumbnailUrl(meta, archiveUrl),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        viewerUrl: '/?archive=' + encodeURIComponent(archiveUrl),
        assets: (meta && meta.assets) || [],
        metadataFields: (meta && meta.metadata_fields) || {}
    };
}

// --- Streaming Multipart Parser ---

/**
 * Find needle Buffer inside haystack Buffer. Returns index or -1.
 */
function bufferIndexOf(haystack, needle) {
    if (needle.length === 0) return 0;
    const len = haystack.length - needle.length;
    outer:
    for (let i = 0; i <= len; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

/**
 * Parse a multipart/form-data upload, streaming file content to disk.
 * Returns { tmpPath, filename }.
 */
function parseMultipartUpload(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
        if (!boundaryMatch) return reject(new Error('No boundary in Content-Type'));

        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const HEADER_END = Buffer.from('\r\n\r\n');
        const endMarker = Buffer.from('\r\n--' + boundary);

        const tmpPath = path.join('/tmp', 'v3d_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
        let writeStream = null;
        let totalSize = 0;
        let filename = '';
        let buffer = Buffer.alloc(0);
        let state = 'preamble'; // preamble | headers | body | done
        let resolved = false;

        function cleanup() {
            if (writeStream) { try { writeStream.destroy(); } catch {} writeStream = null; }
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        function finish(err, result) {
            if (resolved) return;
            resolved = true;
            if (err) { cleanup(); reject(err); }
            else resolve(result);
        }

        req.on('error', (err) => finish(err));

        req.on('data', (chunk) => {
            if (state === 'done') return;
            totalSize += chunk.length;
            if (totalSize > MAX_UPLOAD_SIZE) {
                state = 'done';
                req.destroy();
                return finish(new Error('LIMIT'));
            }
            buffer = Buffer.concat([buffer, chunk]);
            processBuffer();
        });

        req.on('end', () => {
            if (state === 'done') return;
            if (state === 'body' && writeStream) {
                // Flush remaining — try to strip trailing boundary
                flushBody(true);
                writeStream.end(() => finish(null, { tmpPath, filename }));
            } else if (resolved) {
                // already finished
            } else {
                finish(new Error('Incomplete upload'));
            }
        });

        function processBuffer() {
            let iterations = 0;
            while (iterations++ < 100) {
                if (state === 'preamble') {
                    const firstBoundary = Buffer.from('--' + boundary);
                    const idx = bufferIndexOf(buffer, firstBoundary);
                    if (idx === -1) {
                        // Keep tail that might contain partial boundary
                        if (buffer.length > firstBoundary.length) {
                            buffer = buffer.slice(buffer.length - firstBoundary.length);
                        }
                        return;
                    }
                    buffer = buffer.slice(idx + firstBoundary.length);
                    // Skip CRLF after boundary
                    if (buffer.length >= 2 && buffer[0] === 0x0d && buffer[1] === 0x0a) {
                        buffer = buffer.slice(2);
                        state = 'headers';
                    } else if (buffer.length < 2) {
                        return;
                    } else {
                        // Might be end boundary (--), skip
                        state = 'done';
                        return finish(new Error('No file data received'));
                    }
                    continue;
                }

                if (state === 'headers') {
                    const idx = bufferIndexOf(buffer, HEADER_END);
                    if (idx === -1) {
                        // Need more data (headers should be small)
                        if (buffer.length > 16384) {
                            return finish(new Error('Headers too large'));
                        }
                        return;
                    }

                    const headerStr = buffer.slice(0, idx).toString('utf8');
                    buffer = buffer.slice(idx + HEADER_END.length);

                    // Parse Content-Disposition for filename
                    const fnMatch = headerStr.match(/filename="([^"]+)"/i) ||
                                    headerStr.match(/filename=([^\s;]+)/i);
                    if (fnMatch) {
                        filename = sanitizeFilename(fnMatch[1]);
                        writeStream = fs.createWriteStream(tmpPath);
                        writeStream.on('error', (err) => finish(err));
                        state = 'body';
                    } else {
                        // Not a file field — skip to next boundary
                        state = 'preamble';
                    }
                    continue;
                }

                if (state === 'body') {
                    flushBody(false);
                    return;
                }

                return;
            }
        }

        function flushBody(isFinal) {
            // Search for the closing boundary in buffer
            const idx = bufferIndexOf(buffer, endMarker);

            if (idx !== -1) {
                // Found the boundary — write everything before it, we're done
                if (idx > 0) writeStream.write(buffer.slice(0, idx));
                buffer = Buffer.alloc(0);
                state = 'done';
                writeStream.end(() => finish(null, { tmpPath, filename }));
                return;
            }

            if (isFinal) {
                // End of request stream. Write remaining data.
                // There might be a trailing boundary without the leading \r\n at very end.
                // Best effort: check for partial boundary at tail.
                const closingBoundary = Buffer.from('\r\n--' + boundary + '--');
                const closeIdx = bufferIndexOf(buffer, closingBoundary);
                if (closeIdx !== -1) {
                    if (closeIdx > 0) writeStream.write(buffer.slice(0, closeIdx));
                } else if (buffer.length > 0) {
                    writeStream.write(buffer);
                }
                buffer = Buffer.alloc(0);
                return;
            }

            // No boundary found yet — write safe portion, keep holdback for boundary detection
            const holdback = endMarker.length + 2;
            if (buffer.length > holdback) {
                writeStream.write(buffer.slice(0, buffer.length - holdback));
                buffer = buffer.slice(buffer.length - holdback);
            }
        }
    });
}

// --- Admin API Handlers ---

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/**
 * GET /admin — serve the admin HTML page
 */
function handleAdminPage(req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(ADMIN_HTML);
}

/**
 * GET /api/archives — list all archives
 */
function handleListArchives(req, res) {
    try {
        const archives = listArchives();
        const storageUsed = archives.reduce((sum, a) => sum + a.size, 0);
        sendJson(res, 200, { archives, total: archives.length, storageUsed });
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
}

/**
 * POST /api/archives — upload a new archive
 */
async function handleUploadArchive(req, res) {
    try {
        const { tmpPath, filename } = await parseMultipartUpload(req);
        const finalPath = path.join(ARCHIVES_DIR, filename);

        // Ensure archives directory exists
        if (!fs.existsSync(ARCHIVES_DIR)) {
            fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
        }

        // Check for duplicate
        if (fs.existsSync(finalPath)) {
            try { fs.unlinkSync(tmpPath); } catch {}
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }

        // Move from temp to archives (rename if same filesystem, copy+delete otherwise)
        try {
            fs.renameSync(tmpPath, finalPath);
        } catch {
            // Cross-device: copy then delete
            fs.copyFileSync(tmpPath, finalPath);
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        // Extract metadata
        runExtractMeta(finalPath);

        sendJson(res, 201, buildArchiveObject(filename));
    } catch (err) {
        if (err.message === 'LIMIT') {
            sendJson(res, 413, { error: 'Upload exceeds maximum size (' + Math.round(MAX_UPLOAD_SIZE / 1024 / 1024) + ' MB)' });
        } else {
            console.error('[admin] Upload error:', err.message);
            sendJson(res, 500, { error: err.message });
        }
    }
}

/**
 * DELETE /api/archives/:hash — delete an archive and its sidecars
 */
function handleDeleteArchive(req, res, hash) {
    const archive = findArchiveByHash(hash);
    if (!archive) return sendJson(res, 404, { error: 'Archive not found' });

    // Path traversal protection: verify resolved path is under ARCHIVES_DIR
    try {
        const realPath = fs.realpathSync(archive.filePath);
        const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
        if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
            return sendJson(res, 403, { error: 'Access denied' });
        }
    } catch {
        return sendJson(res, 404, { error: 'Archive not found' });
    }

    // Delete archive file
    try { fs.unlinkSync(archive.filePath); } catch {}
    // Remove UUID index entry
    deleteUuidEntry('/archives/' + archive.filename);
    // Delete sidecar files
    try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
    try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}

    sendJson(res, 200, { deleted: true, path: '/archives/' + archive.filename });
}

/**
 * POST /api/archives/:hash/regenerate — re-extract metadata and thumbnail
 */
function handleRegenerateArchive(req, res, hash) {
    const archive = findArchiveByHash(hash);
    if (!archive) return sendJson(res, 404, { error: 'Archive not found' });

    // Delete existing sidecar files so extract-meta.sh does a full re-extract
    try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
    try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}

    runExtractMeta(archive.filePath);

    sendJson(res, 200, buildArchiveObject(archive.filename));
}

/**
 * PATCH /api/archives/:hash — rename an archive
 */
function handleRenameArchive(req, res, hash) {
    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) {
            req.destroy();
            sendJson(res, 413, { error: 'Request body too large' });
        }
    });
    req.on('end', () => {
        try {
            const parsed = JSON.parse(body);
            const newName = parsed.filename;
            if (!newName) return sendJson(res, 400, { error: 'Missing filename' });

            const archive = findArchiveByHash(hash);
            if (!archive) return sendJson(res, 404, { error: 'Archive not found' });

            // Path traversal protection
            try {
                const realPath = fs.realpathSync(archive.filePath);
                const realArchivesDir = fs.realpathSync(ARCHIVES_DIR);
                if (!realPath.startsWith(realArchivesDir + '/') && realPath !== realArchivesDir) {
                    return sendJson(res, 403, { error: 'Access denied' });
                }
            } catch {
                return sendJson(res, 404, { error: 'Archive not found' });
            }

            const sanitized = sanitizeFilename(newName);
            const newPath = path.join(ARCHIVES_DIR, sanitized);

            if (fs.existsSync(newPath)) {
                return sendJson(res, 409, { error: 'File already exists: ' + sanitized });
            }

            // Rename the file
            fs.renameSync(archive.filePath, newPath);

            // Migrate UUID to the new archive path so share links remain stable
            migrateUuid('/archives/' + archive.filename, '/archives/' + sanitized);

            // Clean old sidecar files
            try { fs.unlinkSync(path.join(META_DIR, hash + '.json')); } catch {}
            try { fs.unlinkSync(path.join(THUMBS_DIR, hash + '.jpg')); } catch {}

            // Regenerate metadata for the renamed file
            runExtractMeta(newPath);

            sendJson(res, 200, buildArchiveObject(sanitized));
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
    });
}

// --- Clean URL Handler ---

/**
 * GET /view/:hash — serve the viewer with a clean URL.
 * Injects archive config into index.html so config.js picks it up automatically.
 * URL stays as /view/{hash} — no query params for archive/kiosk/autoload visible.
 */
function handleViewArchive(req, res, hash) {
    const archive = findArchiveByHash(hash);
    if (!archive) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    if (isBotRequest(req)) {
        const archiveUrl = '/archives/' + archive.filename;
        const meta = archive.meta;
        return serveOgHtml(
            res,
            (meta && meta.title) || SITE_NAME,
            (meta && meta.description) || SITE_DESCRIPTION,
            thumbnailUrl(meta, archiveUrl),
            SITE_URL + req.url,
            SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const archiveUrl = '/archives/' + archive.filename;
    const inject = { archive: archiveUrl, kiosk: true, autoload: false };
    inject.theme = DEFAULT_KIOSK_THEME || 'editorial';
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    // Insert <base href="/"> so relative asset paths resolve from root (Vite uses base: './')
    // Insert config inject before the first <script> tag (not CSP's "script-src")
    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

/**
 * GET /view/:uuid — serve the viewer via UUID-based clean URL.
 */
function handleViewArchiveByUuid(req, res, uuid) {
    const archive = findArchiveByUuid(uuid);
    if (!archive) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Archive not found');
        return;
    }

    if (isBotRequest(req)) {
        const archiveUrl = '/archives/' + archive.filename;
        const meta = archive.meta;
        return serveOgHtml(
            res,
            (meta && meta.title) || SITE_NAME,
            (meta && meta.description) || SITE_DESCRIPTION,
            thumbnailUrl(meta, archiveUrl),
            SITE_URL + req.url,
            SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json'
        );
    }

    const indexHtml = getIndexHtml();
    if (!indexHtml) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('index.html not found');
        return;
    }

    const archiveUrl = '/archives/' + archive.filename;
    const inject = { archive: archiveUrl, kiosk: true, autoload: false };
    inject.theme = DEFAULT_KIOSK_THEME || 'editorial';
    const injectTag = '<script>window.__VITRINE_CLEAN_URL=' + JSON.stringify(inject) + ';</script>\n';

    let html = indexHtml.replace(/<head>/i, '<head>\n<base href="/">');
    html = html.replace(/<script[\s>]/i, (m) => injectTag + m);

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
    });
    res.end(html);
}

// --- Chunked Upload ---

/**
 * Remove chunk directories older than 24 hours from CHUNKS_DIR.
 */
function cleanupStaleChunks() {
    try {
        if (!fs.existsSync(CHUNKS_DIR)) return;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const entry of fs.readdirSync(CHUNKS_DIR)) {
            const dirPath = path.join(CHUNKS_DIR, entry);
            try {
                const stat = fs.statSync(dirPath);
                if (stat.isDirectory() && stat.mtimeMs < cutoff) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    console.log('[chunks] Cleaned stale upload dir:', entry);
                }
            } catch { /* ignore */ }
        }
    } catch (err) {
        console.error('[chunks] Cleanup error:', err.message);
    }
}

/**
 * POST /api/archives/chunks?uploadId=&chunkIndex=&totalChunks=&filename=
 * Body: raw binary chunk (application/octet-stream).
 * Streams each chunk to /tmp/v3d_chunks/{uploadId}/{chunkIndex}.part
 */
async function handleUploadChunk(req, res) {
    try {
        const parsed = url.parse(req.url, true);
        const uploadId = (parsed.query.uploadId || '').toString();
        const chunkIndex = parseInt(parsed.query.chunkIndex, 10);
        const totalChunks = parseInt(parsed.query.totalChunks, 10);
        const filename = sanitizeFilename((parsed.query.filename || '').toString());

        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
            return sendJson(res, 400, { error: 'Invalid upload ID' });
        }
        if (!filename || isNaN(chunkIndex) || isNaN(totalChunks)) {
            return sendJson(res, 400, { error: 'Missing required parameters' });
        }
        if (chunkIndex < 0 || chunkIndex >= totalChunks || totalChunks < 1 || totalChunks > 200) {
            return sendJson(res, 400, { error: 'Invalid chunk parameters' });
        }

        const chunkDir = path.join(CHUNKS_DIR, uploadId);
        const metaPath = path.join(chunkDir, 'meta.json');
        const chunkPath = path.join(chunkDir, chunkIndex + '.part');

        if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
        if (!fs.existsSync(metaPath)) {
            fs.writeFileSync(metaPath, JSON.stringify({ filename, totalChunks, created: Date.now() }));
        }

        let received = 0;
        const writeStream = fs.createWriteStream(chunkPath);
        await new Promise((resolve, reject) => {
            req.on('data', (data) => {
                received += data.length;
                if (received > MAX_CHUNK_SIZE) {
                    writeStream.destroy();
                    try { fs.unlinkSync(chunkPath); } catch {}
                    req.destroy();
                    reject(new Error('CHUNK_LIMIT'));
                    return;
                }
                writeStream.write(data);
            });
            req.on('end', () => writeStream.end(resolve));
            req.on('error', reject);
            writeStream.on('error', reject);
        });

        sendJson(res, 200, { received: true, chunkIndex });
    } catch (err) {
        if (err.message === 'CHUNK_LIMIT') {
            sendJson(res, 413, { error: 'Chunk exceeds ' + Math.round(MAX_CHUNK_SIZE / 1024 / 1024) + ' MB limit' });
        } else {
            console.error('[chunks] Upload error:', err.message);
            sendJson(res, 500, { error: err.message });
        }
    }
}

/**
 * POST /api/archives/chunks/:uploadId/complete
 * Assembles all .part files in order into the final archive, then runs extract-meta.
 */
async function handleCompleteChunk(req, res, uploadId) {
    try {
        const chunkDir = path.join(CHUNKS_DIR, uploadId);
        const metaPath = path.join(chunkDir, 'meta.json');
        if (!fs.existsSync(metaPath)) {
            return sendJson(res, 404, { error: 'Upload session not found or expired' });
        }

        let meta;
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
        catch { return sendJson(res, 500, { error: 'Corrupt upload session' }); }

        const { filename, totalChunks } = meta;

        for (let i = 0; i < totalChunks; i++) {
            if (!fs.existsSync(path.join(chunkDir, i + '.part'))) {
                return sendJson(res, 400, { error: 'Missing chunk ' + i + ' of ' + totalChunks });
            }
        }

        if (!fs.existsSync(ARCHIVES_DIR)) fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
        const finalPath = path.join(ARCHIVES_DIR, filename);
        if (fs.existsSync(finalPath)) {
            return sendJson(res, 409, { error: 'File already exists: ' + filename });
        }

        // Assemble chunks in order via streaming
        const tmpPath = path.join('/tmp', 'v3d_assembled_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
        const writeStream = fs.createWriteStream(tmpPath);
        for (let i = 0; i < totalChunks; i++) {
            await new Promise((resolve, reject) => {
                const readStream = fs.createReadStream(path.join(chunkDir, i + '.part'));
                readStream.on('error', reject);
                readStream.on('end', resolve);
                readStream.pipe(writeStream, { end: false });
            });
        }
        await new Promise((resolve, reject) => {
            writeStream.end();
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });

        // Clean up chunk dir before moving (best-effort)
        try { fs.rmSync(chunkDir, { recursive: true, force: true }); } catch {}

        try {
            fs.renameSync(tmpPath, finalPath);
        } catch {
            fs.copyFileSync(tmpPath, finalPath);
            try { fs.unlinkSync(tmpPath); } catch {}
        }

        runExtractMeta(finalPath);
        sendJson(res, 201, buildArchiveObject(filename));
    } catch (err) {
        console.error('[chunks] Assembly error:', err.message);
        sendJson(res, 500, { error: err.message });
    }
}

// --- Server ---

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    const pathname = parsed.pathname;

    // Health check
    if (pathname === '/health') return handleHealth(req, res);

    // oEmbed endpoint
    if (pathname === '/oembed') return handleOembed(req, res);

    // Clean archive URLs: /view/{uuid} (UUID v4, new format)
    const viewUuidMatch = pathname.match(/^\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    if (viewUuidMatch && req.method === 'GET') {
        return handleViewArchiveByUuid(req, res, viewUuidMatch[1]);
    }

    // Clean archive URLs: /view/{hash} (16 hex chars, legacy format)
    const viewMatch = pathname.match(/^\/view\/([a-f0-9]{16})$/);
    if (viewMatch && req.method === 'GET') {
        return handleViewArchive(req, res, viewMatch[1]);
    }

    // Admin routes (only when enabled)
    if (ADMIN_ENABLED) {
        if (pathname === '/admin' && req.method === 'GET') {
            return handleAdminPage(req, res);
        }
        if (pathname === '/api/archives' && req.method === 'GET') {
            return handleListArchives(req, res);
        }
        if (pathname === '/api/archives' && req.method === 'POST') {
            handleUploadArchive(req, res);
            return;
        }

        // Chunked upload routes (only when CHUNKED_UPLOAD=true)
        if (CHUNKED_UPLOAD) {
            if (pathname === '/api/archives/chunks' && req.method === 'POST') {
                handleUploadChunk(req, res);
                return;
            }
            const chunkCompleteMatch = pathname.match(/^\/api\/archives\/chunks\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/complete$/i);
            if (chunkCompleteMatch && req.method === 'POST') {
                handleCompleteChunk(req, res, chunkCompleteMatch[1].toLowerCase());
                return;
            }
        }

        // Match /api/archives/:hash/regenerate
        const regenMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})\/regenerate$/);
        if (regenMatch && req.method === 'POST') {
            return handleRegenerateArchive(req, res, regenMatch[1]);
        }

        // Match /api/archives/:hash (16 hex chars)
        const hashMatch = pathname.match(/^\/api\/archives\/([a-f0-9]{16})$/);
        if (hashMatch) {
            const hash = hashMatch[1];
            if (req.method === 'DELETE') return handleDeleteArchive(req, res, hash);
            if (req.method === 'PATCH') return handleRenameArchive(req, res, hash);
        }
    }

    // Default: bot HTML response (nginx only routes bots here)
    return handleBotRequest(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[meta-server] Listening on 127.0.0.1:${PORT}`);
    if (CHUNKED_UPLOAD) {
        console.log(`[meta-server] Chunked upload: ENABLED (chunks dir: ${CHUNKS_DIR})`);
        cleanupStaleChunks();
        setInterval(cleanupStaleChunks, 60 * 60 * 1000);
    }
    console.log(`[meta-server] SITE_NAME=${SITE_NAME}`);
    console.log(`[meta-server] SITE_URL=${SITE_URL || '(not set)'}`);
    if (ADMIN_ENABLED) {
        console.log(`[meta-server] Admin panel: ENABLED`);
        console.log(`[meta-server] MAX_UPLOAD_SIZE=${Math.round(MAX_UPLOAD_SIZE / 1024 / 1024)} MB`);
    }
});
