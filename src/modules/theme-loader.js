/**
 * Theme Loader — Fetches and applies kiosk theme CSS + layout files at runtime.
 *
 * Theme files live in themes/{name}/
 *   theme.css   — CSS variable overrides (required)
 *   layout.css  — Layout-specific CSS rules (optional, for non-sidebar layouts)
 *   layout.js   — Layout-specific DOM creation (optional, self-registers on window.__KIOSK_LAYOUTS__)
 *
 * Metadata is parsed from the first CSS comment block in theme.css:
 *   @theme   Display Name
 *   @layout  sidebar|editorial
 *   @scene-bg #hex
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('theme-loader');

const DEFAULT_META = { layout: 'sidebar', sceneBg: null, name: null, layoutModule: null };

/**
 * Fetch raw CSS text from a URL.
 *
 * Vite's dev server transforms CSS files into JS modules (for HMR), so a plain
 * fetch() returns JavaScript, not CSS. This helper detects that case and uses
 * dynamic import with ?raw to retrieve the actual CSS content.
 *
 * In production (nginx, static hosting), the response is plain CSS and is
 * returned directly.
 *
 * @param {string} url - Relative or absolute URL to a .css file
 * @returns {Promise<string|null>} Raw CSS text, or null if not found
 */
async function fetchRawCSS(url) {
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const contentType = resp.headers.get('content-type') || '';

    // Direct CSS response (production servers, nginx, static hosting)
    if (contentType.includes('text/css') || contentType.includes('text/plain')) {
        return resp.text();
    }

    // Vite dev server transforms CSS → JS module for HMR support.
    // Use dynamic import with ?raw suffix to get the raw CSS text.
    try {
        const rawUrl = new URL(url + '?raw', window.location.href).href;
        const mod = await import(/* @vite-ignore */ rawUrl);
        return mod.default;
    } catch {
        log.warn(`CSS returned non-CSS content-type (${contentType}) and ?raw import failed: ${url}`);
        return null;
    }
}

/**
 * Parse theme metadata from the first CSS block comment.
 * @param {string} css - Raw CSS text
 * @returns {{ layout: string, sceneBg: string|null, name: string|null }}
 */
export function parseThemeMeta(css) {
    const meta = { ...DEFAULT_META };
    const match = css.match(/\/\*[\s\S]*?\*\//);
    if (!match) return meta;

    const comment = match[0];
    const layoutMatch = comment.match(/@layout\s+(\S+)/);
    const sceneBgMatch = comment.match(/@scene-bg\s+(#[0-9a-fA-F]{3,8})/);
    const nameMatch = comment.match(/@theme\s+(.+)/);

    if (layoutMatch) meta.layout = layoutMatch[1].trim();
    if (sceneBgMatch) meta.sceneBg = sceneBgMatch[1].trim();
    if (nameMatch) meta.name = nameMatch[1].trim();

    return meta;
}

/**
 * Look up a layout module from the global registry.
 */
function getLayoutModule(layoutName) {
    const registry = window.__KIOSK_LAYOUTS__;
    return (registry && registry[layoutName]) ? registry[layoutName] : null;
}

/**
 * Load layout.css and layout.js for a non-sidebar theme.
 */
async function loadLayoutFiles(baseUrl, meta) {
    // Try to load layout.css
    try {
        const css = await fetchRawCSS(baseUrl + 'layout.css');
        if (css) {
            let el = document.getElementById('kiosk-layout');
            if (!el) {
                el = document.createElement('style');
                el.id = 'kiosk-layout';
                document.head.appendChild(el);
            }
            el.textContent = css;
            log.info('Layout CSS loaded');
        } else {
            log.warn(`Layout CSS not found: ${baseUrl}layout.css`);
        }
    } catch (e) {
        log.warn(`Layout CSS fetch error: ${e.message}`);
    }

    // Check for pre-registered layout module first (offline kiosk)
    meta.layoutModule = getLayoutModule(meta.layout);
    if (meta.layoutModule) {
        log.info(`Layout module found in registry: ${meta.layout}`);
        return;
    }

    // Try dynamic import of layout.js
    // Use absolute URL because import() resolves relative to this module's
    // location (/modules/), not the document root where themes/ lives.
    try {
        const layoutUrl = new URL(baseUrl + 'layout.js', window.location.href).href;
        await import(/* @vite-ignore */ layoutUrl);
        meta.layoutModule = getLayoutModule(meta.layout);
        if (meta.layoutModule) {
            log.info(`Layout module loaded: ${meta.layout}`);
        } else {
            log.warn(`layout.js loaded but no module registered for "${meta.layout}"`);
        }
    } catch (e) {
        log.warn(`Layout JS import error: ${e.message}`);
    }
}

/**
 * Load and inject a theme by folder name.
 * @param {string} name - Theme folder name (e.g., 'editorial')
 * @param {Object} [options] - Optional settings
 * @param {string} [options.layoutOverride] - URL ?layout= override; if 'sidebar', skip loading layout files
 * @returns {Promise<{ layout: string, sceneBg: string|null, name: string|null, layoutModule: object|null }>}
 */
export async function loadTheme(name, options) {
    if (!name) {
        log.info('No theme specified, using defaults');
        return { ...DEFAULT_META };
    }

    const layoutOverride = options && options.layoutOverride;

    // Check for pre-inlined theme CSS (offline kiosk viewer)
    const existing = document.getElementById('kiosk-theme');
    if (existing && existing.textContent.trim()) {
        log.info(`Using pre-inlined theme CSS for: ${name}`);
        const meta = parseThemeMeta(existing.textContent);

        // Check for pre-inlined layout CSS
        const existingLayout = document.getElementById('kiosk-layout');
        if (existingLayout) log.info('Using pre-inlined layout CSS');

        // Check for pre-registered layout module (loaded by bootstrap)
        meta.layoutModule = getLayoutModule(meta.layout);
        if (meta.layoutModule) {
            log.info(`Layout module found in registry: ${meta.layout}`);
        }

        return meta;
    }

    const baseUrl = `themes/${name}/`;
    log.info(`Loading theme: ${name}`);

    try {
        const css = await fetchRawCSS(baseUrl + 'theme.css');
        if (!css) {
            log.warn(`Theme "${name}" not found, using defaults`);
            return { ...DEFAULT_META };
        }

        const meta = parseThemeMeta(css);

        // Inject theme CSS
        let styleEl = document.getElementById('kiosk-theme');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'kiosk-theme';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;

        // Load layout files for non-sidebar layouts (skip if URL overrides to sidebar)
        const effectiveLayout = layoutOverride || meta.layout;
        if (effectiveLayout !== 'sidebar') {
            await loadLayoutFiles(baseUrl, meta);
        } else if (meta.layout !== 'sidebar' && layoutOverride === 'sidebar') {
            log.info(`Skipping layout files: URL overrides ${meta.layout} → sidebar`);
        }

        log.info(`Theme loaded: ${meta.name || name} (layout: ${meta.layout}, scene-bg: ${meta.sceneBg || 'default'})`);
        return meta;
    } catch (err) {
        log.warn(`Failed to load theme "${name}": ${err.message}`);
        return { ...DEFAULT_META };
    }
}
