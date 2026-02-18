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
 *   @layout  sidebar|{custom}  (custom names match a layout.js module, e.g. editorial)
 *   @scene-bg #hex
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('theme-loader');

/** Contract for a kiosk layout module (registered on window.__KIOSK_LAYOUTS__). */
export interface LayoutModule {
    /** Main UI setup — called after archive loads (or for direct-file loads). */
    setup(manifest: any, deps: any): void;
    /** Customize the loading overlay before archive loading begins. */
    initLoadingScreen?(container: HTMLElement, deps: any): void;
    /** Customize the click-to-load gate. */
    initClickGate?(container: HTMLElement, deps: any): void;
    /** Customize the file picker overlay. */
    initFilePicker?(container: HTMLElement, deps: any): void;

    /** Called when an annotation is selected (e.g. highlight a sequence number). */
    onAnnotationSelect?(annotationId: string): void;
    /** Called when an annotation is deselected. */
    onAnnotationDeselect?(): void;
    /** Called when the active display/view mode changes. */
    onViewModeChange?(mode: string): void;
    /** Called for keyboard shortcuts. Return true if the layout handled the key. */
    onKeyboardShortcut?(key: string): boolean;

    /** If true, the layout creates its own info/metadata panel (kiosk-main skips wall label + info overlay). */
    hasOwnInfoPanel?: boolean;
    /** If true, the layout creates its own SD/HD quality toggle. */
    hasOwnQualityToggle?: boolean;
}

interface ThemeMeta {
    layout: string;
    sceneBg: string | null;
    name: string | null;
    layoutModule: LayoutModule | null;
}

const DEFAULT_META: ThemeMeta = { layout: 'sidebar', sceneBg: null, name: null, layoutModule: null };

interface LoadThemeOptions {
    layoutOverride?: string;
}

declare global {
    interface Window {
        __KIOSK_LAYOUTS__?: Record<string, LayoutModule>;
    }
}

/**
 * Fetch raw CSS text from a URL.
 *
 * Vite's dev server transforms CSS files into JS modules (for HMR), so a plain
 * fetch() returns JavaScript, not CSS. This helper detects that case and uses
 * dynamic import with ?raw to retrieve the actual CSS content.
 *
 * In production (nginx, static hosting), the response is plain CSS and is
 * returned directly.
 */
async function fetchRawCSS(url: string): Promise<string | null> {
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
 */
export function parseThemeMeta(css: string): ThemeMeta {
    const meta: ThemeMeta = { ...DEFAULT_META };
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
function getLayoutModule(layoutName: string): LayoutModule | null {
    const registry = window.__KIOSK_LAYOUTS__;
    return (registry && registry[layoutName]) ? registry[layoutName] : null;
}

/**
 * Load layout.css and layout.js for a non-sidebar theme.
 */
async function loadLayoutFiles(baseUrl: string, meta: ThemeMeta): Promise<void> {
    // Try to load layout.css
    try {
        const css = await fetchRawCSS(baseUrl + 'layout.css');
        if (css) {
            let el = document.getElementById('kiosk-layout') as HTMLStyleElement | null;
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
        const message = e instanceof Error ? e.message : String(e);
        log.warn(`Layout CSS fetch error: ${message}`);
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
        const message = e instanceof Error ? e.message : String(e);
        log.warn(`Layout JS import error: ${message}`);
    }
}

/**
 * Load and inject a theme by folder name.
 */
export async function loadTheme(name: string, options?: LoadThemeOptions): Promise<ThemeMeta> {
    if (!name) {
        log.info('No theme specified, using defaults');
        return { ...DEFAULT_META };
    }

    const layoutOverride = options?.layoutOverride;

    // Check for pre-inlined theme CSS (offline kiosk viewer)
    const existing = document.getElementById('kiosk-theme') as HTMLStyleElement | null;
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
        let styleEl = document.getElementById('kiosk-theme') as HTMLStyleElement | null;
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
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to load theme "${name}": ${message}`);
        return { ...DEFAULT_META };
    }
}
