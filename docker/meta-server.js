#!/usr/bin/env node
'use strict';

/**
 * meta-server.js — Lightweight OG/oEmbed metadata server for Vitrine3D
 *
 * Runs alongside nginx inside the Docker container. Zero npm dependencies.
 *
 * Routes:
 *   GET / (bot user-agent)  → HTML with OG + Twitter Card meta tags
 *   GET /oembed              → oEmbed JSON response
 *   GET /health              → 200 OK
 *
 * Reads pre-extracted metadata from /usr/share/nginx/html/meta/{hash}.json
 * and serves thumbnails from /usr/share/nginx/html/thumbs/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

// --- Configuration from environment ---

const PORT = parseInt(process.env.META_PORT || '3001', 10);
const SITE_NAME = process.env.SITE_NAME || 'Vitrine3D';
const SITE_URL = process.env.SITE_URL || '';
const SITE_DESCRIPTION = process.env.SITE_DESCRIPTION || 'Interactive 3D viewer';
const OEMBED_WIDTH = parseInt(process.env.OEMBED_WIDTH || '960', 10);
const OEMBED_HEIGHT = parseInt(process.env.OEMBED_HEIGHT || '540', 10);

const HTML_ROOT = '/usr/share/nginx/html';
const META_DIR = path.join(HTML_ROOT, 'meta');
const THUMBS_DIR = path.join(HTML_ROOT, 'thumbs');

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

// --- Route handlers ---

/**
 * Generate HTML with OG + Twitter Card meta tags for bot crawlers.
 * Includes a meta-refresh redirect to the real SPA URL.
 */
function handleBotRequest(req, res) {
    const parsed = url.parse(req.url, true);
    const archiveUrl = parsed.query.archive || '';
    const meta = readMeta(archiveUrl);

    const title = escapeHtml((meta && meta.title) || SITE_NAME);
    const description = escapeHtml((meta && meta.description) || SITE_DESCRIPTION);
    const thumb = escapeHtml(thumbnailUrl(meta, archiveUrl));
    const canonicalUrl = escapeHtml(SITE_URL + (req.url || '/'));
    const oembedUrl = escapeHtml(SITE_URL + '/oembed?url=' + encodeURIComponent(SITE_URL + req.url) + '&format=json');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:url" content="${canonicalUrl}">
    ${thumb ? `<meta property="og:image" content="${thumb}">` : ''}

    <!-- Twitter Card -->
    <meta name="twitter:card" content="${thumb ? 'summary_large_image' : 'summary'}">
    <meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}">
    ${thumb ? `<meta name="twitter:image" content="${thumb}">` : ''}

    <!-- oEmbed discovery -->
    <link rel="alternate" type="application/json+oembed" href="${oembedUrl}" title="${title}">

    <!-- Redirect human visitors that somehow reach this page -->
    <meta http-equiv="refresh" content="0;url=${canonicalUrl}">
</head>
<body>
    <p>Redirecting to <a href="${canonicalUrl}">${title}</a>...</p>
</body>
</html>`;

    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
    });
    res.end(html);
}

/**
 * Handle /oembed requests per the oEmbed specification.
 * https://oembed.com/
 */
function handleOembed(req, res) {
    const parsed = url.parse(req.url, true);
    const viewerUrl = parsed.query.url || '';
    const format = parsed.query.format || 'json';

    // Only JSON format is supported
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

    const archiveUrl = extractArchiveParam(viewerUrl);
    const meta = readMeta(archiveUrl);

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

    // Add thumbnail if available
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

// --- Server ---

const server = http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/health') {
        return handleHealth(req, res);
    }
    if (pathname === '/oembed') {
        return handleOembed(req, res);
    }
    // All other paths: bot HTML response (nginx only routes bots here)
    return handleBotRequest(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[meta-server] Listening on 127.0.0.1:${PORT}`);
    console.log(`[meta-server] SITE_NAME=${SITE_NAME}`);
    console.log(`[meta-server] SITE_URL=${SITE_URL || '(not set — OG URLs will be relative)'}`);
    console.log(`[meta-server] OEMBED_WIDTH=${OEMBED_WIDTH} OEMBED_HEIGHT=${OEMBED_HEIGHT}`);
});
