/**
 * Application Constants
 *
 * Centralized configuration values for the Gaussian Splat & Mesh Viewer.
 * Edit these values to customize the application behavior.
 */

// =============================================================================
// CAMERA SETTINGS
// =============================================================================

export const CAMERA = {
    FOV: 60,                          // Field of view in degrees
    NEAR: 0.1,                        // Near clipping plane
    FAR: 1000,                        // Far clipping plane
    INITIAL_POSITION: { x: 0, y: 1, z: 3 }  // Starting camera position
};

// =============================================================================
// ORBIT CONTROLS
// =============================================================================

export const ORBIT_CONTROLS = {
    DAMPING_FACTOR: 0.05,             // Smoothing factor for camera movement
    MIN_DISTANCE: 0.1,                // Minimum zoom distance
    MAX_DISTANCE: 100                 // Maximum zoom distance
};

// =============================================================================
// RENDERER SETTINGS
// =============================================================================

export const RENDERER = {
    MAX_PIXEL_RATIO: 2                // Cap pixel ratio to prevent performance issues on high-DPI displays
};

// =============================================================================
// LIGHTING CONFIGURATION
// =============================================================================

export const LIGHTING = {
    AMBIENT: {
        COLOR: 0xffffff,
        INTENSITY: 0.8
    },
    HEMISPHERE: {
        SKY_COLOR: 0xffffff,
        GROUND_COLOR: 0x444444,
        INTENSITY: 0.6
    },
    DIRECTIONAL_1: {
        COLOR: 0xffffff,
        INTENSITY: 1.5,
        POSITION: { x: 5, y: 5, z: 5 }
    },
    DIRECTIONAL_2: {
        COLOR: 0xffffff,
        INTENSITY: 0.5,
        POSITION: { x: -5, y: 3, z: -5 }
    }
};

// =============================================================================
// GRID HELPER
// =============================================================================

export const GRID = {
    SIZE: 20,                         // Grid size in units
    DIVISIONS: 20,                    // Number of grid divisions
    COLOR_PRIMARY: 0x4a4a6a,          // Main grid line color
    COLOR_SECONDARY: 0x2a2a3a,        // Secondary grid line color
    Y_OFFSET: -0.01                   // Slight offset to avoid z-fighting
};

// =============================================================================
// SCENE COLORS
// =============================================================================

export const COLORS = {
    // Default scene background
    SCENE_BACKGROUND: 0x1a1a2e,

    // Default material color for meshes without materials
    DEFAULT_MATERIAL: 0x888888,

    // Background color presets (matching CSS button data-color attributes)
    PRESETS: {
        DARK_PURPLE: '#1a1a2e',
        DARK_GRAY: '#2d2d2d',
        LIGHT_GRAY: '#808080',
        WHITE: '#f0f0f0'
    }
};

// =============================================================================
// TIMING / DELAYS (milliseconds)
// =============================================================================

export const TIMING = {
    // Delay after loading splat to ensure rendering is ready
    SPLAT_LOAD_DELAY: 100,

    // Delay after loading model from blob
    MODEL_LOAD_DELAY: 100,

    // Delay before auto-alignment after archive load
    AUTO_ALIGN_DELAY: 500,

    // Delay before revoking blob URLs (cleanup)
    BLOB_REVOKE_DELAY: 5000,

    // Delay for URL-based model loading
    URL_MODEL_LOAD_DELAY: 500
};

// =============================================================================
// MATERIAL DEFAULTS
// =============================================================================

export const MATERIAL = {
    DEFAULT_METALNESS: 0.1,
    DEFAULT_ROUGHNESS: 0.8,
    DEFAULT_OPACITY: 1.0
};

// =============================================================================
// TRANSFORM DEFAULTS
// =============================================================================

export const TRANSFORM = {
    DEFAULT_POSITION: { x: 0, y: 0, z: 0 },
    DEFAULT_ROTATION: { x: 0, y: 0, z: 0 },
    DEFAULT_SCALE: 1.0
};

// =============================================================================
// UI CONFIGURATION
// =============================================================================

export const UI = {
    // Controls panel width when visible
    CONTROLS_PANEL_WIDTH: '280px',

    // FPS counter update is handled by the animation loop
    // No specific timing constant needed
};

// =============================================================================
// FILE HANDLING
// =============================================================================

export const FILES = {
    // Supported file extensions
    SPLAT_EXTENSIONS: ['.ply', '.splat', '.ksplat', '.spz', '.sog'],
    MODEL_EXTENSIONS: ['.glb', '.gltf', '.obj'],
    ARCHIVE_EXTENSIONS: ['.a3d', '.a3z']
};
