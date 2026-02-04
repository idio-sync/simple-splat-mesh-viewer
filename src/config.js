// Runtime configuration
// Supports URL parameters for embedding:
//   ?archive=URL     - Archive container file (.a3d, .a3z) - takes priority over splat/model
//   ?splat=URL       - Default splat file to load
//   ?model=URL       - Default model file to load
//   ?alignment=URL   - Default alignment JSON file to load
//   ?controls=MODE   - Control panel mode: full, minimal, none
//   ?mode=VIEW       - Initial view mode: splat, model, both, split
//   ?toolbar=STATE   - Toolbar visibility: show, hide
//   ?sidebar=STATE   - Metadata sidebar state: closed, view, edit
//
// Inline alignment params (alternative to alignment JSON file):
//   ?sp=x,y,z        - Splat position
//   ?sr=x,y,z        - Splat rotation (radians)
//   ?ss=scale        - Splat scale
//   ?mp=x,y,z        - Model position
//   ?mr=x,y,z        - Model rotation (radians)
//   ?ms=scale        - Model scale
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
            const allowedProtocols = ['http:', 'https:'];
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

    // Get and validate URL parameters
    const archiveUrl = validateUrl(params.get('archive'), 'archive');
    const splatUrl = validateUrl(params.get('splat'), 'splat');
    const modelUrl = validateUrl(params.get('model'), 'model');
    const alignmentUrl = validateUrl(params.get('alignment'), 'alignment');
    const controlsMode = params.get('controls') || 'full'; // full, minimal, none
    const viewMode = params.get('mode') || 'both'; // splat, model, both, split
    const toolbarMode = params.get('toolbar') || 'show'; // show, hide
    const sidebarMode = params.get('sidebar') || 'closed'; // closed, view, edit

    // Parse inline alignment params
    const splatPos = parseVec3(params.get('sp'));
    const splatRot = parseVec3(params.get('sr'));
    const splatScale = params.get('ss') ? parseFloat(params.get('ss')) : null;
    const modelPos = parseVec3(params.get('mp'));
    const modelRot = parseVec3(params.get('mr'));
    const modelScale = params.get('ms') ? parseFloat(params.get('ms')) : null;

    // Build inline alignment object if any params are present
    let inlineAlignment = null;
    if (splatPos || splatRot || splatScale !== null || modelPos || modelRot || modelScale !== null) {
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
    }

    // Determine what to show based on controls mode
    // full: show everything
    // minimal: only display mode toggle and toggle button
    // none: hide all controls (view only)

    window.APP_CONFIG = {
        defaultArchiveUrl: archiveUrl,
        defaultSplatUrl: splatUrl,
        defaultModelUrl: modelUrl,
        defaultAlignmentUrl: alignmentUrl,
        inlineAlignment: inlineAlignment,
        showControls: controlsMode !== 'none',
        controlsMode: controlsMode,
        initialViewMode: viewMode,
        // Viewer mode settings
        showToolbar: toolbarMode !== 'hide',
        sidebarMode: sidebarMode // closed, view, edit
    };
})();
