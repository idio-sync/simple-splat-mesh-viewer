// Runtime configuration (local dev version — no env var substitution)
//
// Docker-only env vars (enforced in docker/config.js.template, not here):
//   KIOSK_LOCK=true          Forces kiosk mode, ignores privilege-escalating URL params
//   ARCHIVE_PATH_PREFIX=path  Restricts archives to a path prefix (e.g., "/archives/")
//   EMBED_REFERERS=domains    nginx valid_referers check (e.g., "client.com *.client.com")
//   FRAME_ANCESTORS=origins   CSP frame-ancestors for iframe embedding
//
// Supports URL parameters for embedding:
//   ?archive=URL     - Archive container file (.a3d, .a3z) - takes priority over splat/model
//   ?splat=URL       - Default splat file to load
//   ?model=URL       - Default model file to load
//   ?pointcloud=URL  - Default E57 point cloud file to load
//   ?alignment=URL   - Default alignment JSON file to load
//   ?controls=MODE   - Control panel mode: full, minimal, none
//   ?mode=VIEW       - Initial view mode: splat, model, pointcloud, both, split
//   ?toolbar=STATE   - Toolbar visibility: show, hide
//   ?sidebar=STATE   - Metadata sidebar state: closed, view, edit
//   ?theme=NAME      - Kiosk theme folder name (e.g., editorial, minimal)
//   ?layout=STYLE    - Kiosk layout override: sidebar, editorial (overrides theme default)
//   ?autoload=BOOL   - Auto-load archive on page load: true (default), false (show click-to-load gate)
//
// Inline alignment params (alternative to alignment JSON file):
//   ?sp=x,y,z        - Splat position
//   ?sr=x,y,z        - Splat rotation (radians)
//   ?ss=scale        - Splat scale
//   ?mp=x,y,z        - Model position
//   ?mr=x,y,z        - Model rotation (radians)
//   ?ms=scale        - Model scale
//   ?pp=x,y,z        - Point cloud position
//   ?pr=x,y,z        - Point cloud rotation (radians)
//   ?ps=scale        - Point cloud scale
//
// Security:
//   By default, only same-origin URLs are allowed. To allow external domains,
//   add them to the ALLOWED_EXTERNAL_DOMAINS array below.
//
// Examples:
//   viewer.website.com?archive=/assets/scene.a3d&controls=minimal
//   viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=minimal
//   viewer.website.com?splat=https://example.com/file.ply&controls=none&mode=split
//   viewer.website.com?splat=/scene.ply&model=/model.glb&alignment=/alignment.json
//   viewer.website.com?splat=/scene.ply&sp=0,1,0&sr=0,3.14,0&ss=1.5
//   viewer.website.com?archive=/scene.a3d&toolbar=hide&sidebar=view (viewer mode)

(function() {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);

    // =========================================================================
    // URL VALIDATION - Security measure to prevent loading from untrusted sources
    // =========================================================================

    // Add trusted external domains here (e.g., CDN hosts, trusted APIs)
    // Same-origin URLs are always allowed
    const ALLOWED_EXTERNAL_DOMAINS = [
        // 'trusted-cdn.example.com',
        // 'assets.mycompany.com',
    ];

    /**
     * Validates a URL parameter to prevent SSRF and malicious URL injection.
     *
     * @param {string} urlString - The URL string to validate
     * @param {string} paramName - Name of the parameter (for logging)
     * @returns {string} - Validated URL string, or empty string if invalid
     */
    function validateUrl(urlString, paramName) {
        if (!urlString || urlString.trim() === '') {
            return '';
        }

        try {
            // Parse the URL (relative URLs resolved against current origin)
            const url = new URL(urlString, window.location.origin);

            // Block dangerous protocols (javascript:, data:, vbscript:, etc.)
            // tauri: and asset: are Tauri v2 same-origin protocols used when the app
            // is served from the bundled frontend (tauri://localhost or asset://localhost).
            const allowedProtocols = ['http:', 'https:', 'tauri:', 'asset:'];
            if (!allowedProtocols.includes(url.protocol)) {
                console.warn(`[config] Blocked unsafe protocol for ${paramName}:`, url.protocol);
                return '';
            }

            // Check if same-origin
            const isSameOrigin = url.origin === window.location.origin;

            // Check if domain is in allowed list
            const isAllowedExternal = ALLOWED_EXTERNAL_DOMAINS.some(domain => {
                // Support wildcard subdomains (*.example.com)
                if (domain.startsWith('*.')) {
                    const baseDomain = domain.slice(2);
                    return url.hostname === baseDomain || url.hostname.endsWith('.' + baseDomain);
                }
                return url.hostname === domain;
            });

            if (!isSameOrigin && !isAllowedExternal) {
                console.warn(`[config] Blocked external URL for ${paramName}:`, url.hostname);
                console.info(`[config] To allow this domain, add '${url.hostname}' to ALLOWED_EXTERNAL_DOMAINS in config.js`);
                return '';
            }

            // Enforce HTTPS for external URLs in production (when page is served over HTTPS)
            if (!isSameOrigin && window.location.protocol === 'https:' && url.protocol !== 'https:') {
                console.warn(`[config] Blocked insecure external URL for ${paramName} (HTTPS required):`, urlString);
                return '';
            }

            // URL is valid
            console.info(`[config] Validated ${paramName}:`, url.href);
            return url.href;

        } catch (e) {
            console.warn(`[config] Invalid URL for ${paramName}:`, urlString, e.message);
            return '';
        }
    }

    // Helper to parse comma-separated numbers
    function parseVec3(str) {
        if (!str) return null;
        const parts = str.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
            return parts;
        }
        return null;
    }

    // Clean URL injection (set by meta-server for /view/{hash} routes)
    const _inj = window.__VITRINE_CLEAN_URL || {};

    // Get and validate URL parameters
    const archiveUrl = validateUrl(params.get('archive') || _inj.archive || '', 'archive');
    const splatUrl = validateUrl(params.get('splat'), 'splat');
    const modelUrl = validateUrl(params.get('model'), 'model');
    const pointcloudUrl = validateUrl(params.get('pointcloud'), 'pointcloud');
    const alignmentUrl = validateUrl(params.get('alignment'), 'alignment');
    const kioskMode = params.get('kiosk') === 'true' || (!params.has('kiosk') && _inj.kiosk === true);
    const controlsMode = kioskMode ? 'none' : (params.get('controls') || 'full'); // full, minimal, none
    const viewMode = params.get('mode') || (kioskMode ? 'both' : 'model'); // splat, model, pointcloud, both, split
    const toolbarMode = kioskMode ? 'show' : (params.get('toolbar') || 'show'); // show, hide
    const sidebarMode = kioskMode ? 'closed' : (params.get('sidebar') || 'closed'); // closed, view, edit
    const themeName = params.get('theme') || _inj.theme || (kioskMode ? 'editorial' : '');
    const layoutStyle = params.get('layout') || ''; // optional override; theme provides default
    const autoload = params.has('autoload') ? params.get('autoload') !== 'false' : (_inj.autoload !== undefined ? _inj.autoload : true);

    // Parse inline alignment params
    const splatPos = parseVec3(params.get('sp'));
    const splatRot = parseVec3(params.get('sr'));
    const splatScale = params.get('ss') ? parseFloat(params.get('ss')) : null;
    const modelPos = parseVec3(params.get('mp'));
    const modelRot = parseVec3(params.get('mr'));
    const modelScale = params.get('ms') ? parseFloat(params.get('ms')) : null;
    const pcPos = parseVec3(params.get('pp'));
    const pcRot = parseVec3(params.get('pr'));
    const pcScale = params.get('ps') ? parseFloat(params.get('ps')) : null;

    // Build inline alignment object if any params are present
    let inlineAlignment = null;
    if (splatPos || splatRot || splatScale !== null || modelPos || modelRot || modelScale !== null || pcPos || pcRot || pcScale !== null) {
        inlineAlignment = {};
        if (splatPos || splatRot || splatScale !== null) {
            inlineAlignment.splat = {
                position: splatPos || [0, 0, 0],
                rotation: splatRot || [0, 0, 0],
                scale: splatScale !== null && !isNaN(splatScale) ? splatScale : 1
            };
        }
        if (modelPos || modelRot || modelScale !== null) {
            inlineAlignment.model = {
                position: modelPos || [0, 0, 0],
                rotation: modelRot || [0, 0, 0],
                scale: modelScale !== null && !isNaN(modelScale) ? modelScale : 1
            };
        }
        if (pcPos || pcRot || pcScale !== null) {
            inlineAlignment.pointcloud = {
                position: pcPos || [0, 0, 0],
                rotation: pcRot || [0, 0, 0],
                scale: pcScale !== null && !isNaN(pcScale) ? pcScale : 1
            };
        }
    }

    // Determine what to show based on controls mode
    // full: show everything
    // minimal: only display mode toggle and toggle button
    // none: hide all controls (view only)

    window.APP_CONFIG = {
        kiosk: kioskMode,
        defaultArchiveUrl: archiveUrl,
        defaultSplatUrl: splatUrl,
        defaultModelUrl: modelUrl,
        defaultPointcloudUrl: pointcloudUrl,
        defaultAlignmentUrl: alignmentUrl,
        inlineAlignment: inlineAlignment,
        showControls: controlsMode !== 'none',
        controlsMode: controlsMode,
        initialViewMode: viewMode,
        // Viewer mode settings
        showToolbar: toolbarMode !== 'hide',
        sidebarMode: sidebarMode, // closed, view, edit
        theme: themeName, // theme folder name
        layout: layoutStyle, // optional layout override
        autoload: autoload, // false = show click-to-load gate before downloading

        // Allowed external domains (shared with main.js URL validation)
        allowedDomains: ALLOWED_EXTERNAL_DOMAINS,

        // LOD splat budgets (0 = use quality-tier.ts defaults)
        lodBudgetSd: 0,
        lodBudgetHd: 0,

        // Library (archive management) — disabled in local dev, enabled via ADMIN_ENABLED in Docker
        libraryEnabled: false
    };
})();
