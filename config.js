// Runtime configuration
// Supports URL parameters for embedding:
//   ?archive=URL     - Archive container file (.a3d, .a3z) - takes priority over splat/model
//   ?splat=URL       - Default splat file to load
//   ?model=URL       - Default model file to load
//   ?alignment=URL   - Default alignment JSON file to load
//   ?controls=MODE   - Control panel mode: full, minimal, none
//   ?mode=VIEW       - Initial view mode: splat, model, both, split
//
// Inline alignment params (alternative to alignment JSON file):
//   ?sp=x,y,z        - Splat position
//   ?sr=x,y,z        - Splat rotation (radians)
//   ?ss=scale        - Splat scale
//   ?mp=x,y,z        - Model position
//   ?mr=x,y,z        - Model rotation (radians)
//   ?ms=scale        - Model scale
//
// Examples:
//   viewer.website.com?archive=/assets/scene.a3d&controls=minimal
//   viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=minimal
//   viewer.website.com?splat=https://example.com/file.ply&controls=none&mode=split
//   viewer.website.com?splat=/scene.ply&model=/model.glb&alignment=/alignment.json
//   viewer.website.com?splat=/scene.ply&sp=0,1,0&sr=0,3.14,0&ss=1.5

(function() {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);

    // Helper to parse comma-separated numbers
    function parseVec3(str) {
        if (!str) return null;
        const parts = str.split(',').map(s => parseFloat(s.trim()));
        if (parts.length === 3 && parts.every(n => !isNaN(n))) {
            return parts;
        }
        return null;
    }

    // Get parameters with defaults
    const archiveUrl = params.get('archive') || '';
    const splatUrl = params.get('splat') || '';
    const modelUrl = params.get('model') || '';
    const alignmentUrl = params.get('alignment') || '';
    const controlsMode = params.get('controls') || 'full'; // full, minimal, none
    const viewMode = params.get('mode') || 'both'; // splat, model, both, split

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
        initialViewMode: viewMode
    };
})();
