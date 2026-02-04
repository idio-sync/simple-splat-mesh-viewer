/**
 * Utility Functions Module
 *
 * Centralized utilities for the Gaussian Splat & Mesh Viewer:
 * - Logging with configurable log levels
 * - Error handling and user notifications
 * - Mesh processing utilities
 */

import * as THREE from 'three';
import { COLORS, MATERIAL } from './constants.js';

// =============================================================================
// LOGGING SYSTEM
// =============================================================================

/**
 * Log levels in order of verbosity (lower = more verbose)
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * Centralized logging system with configurable log levels.
 *
 * Features:
 * - Configurable log levels (DEBUG, INFO, WARN, ERROR, NONE)
 * - Module prefixes for easy filtering
 * - URL parameter override (?log=debug)
 * - Production-friendly defaults (WARN level)
 * - Timestamp support for debugging
 *
 * Usage:
 *   const log = Logger.getLogger('ModuleName');
 *   log.debug('Detailed info for debugging');
 *   log.info('General information');
 *   log.warn('Warning message');
 *   log.error('Error message', errorObject);
 */
class Logger {
    static _level = LogLevel.WARN; // Default to WARN for production
    static _showTimestamps = false;
    static _initialized = false;
    static _loggers = new Map();

    /**
     * Initialize the logging system.
     * Checks URL parameters and sets appropriate log level.
     */
    static init() {
        if (Logger._initialized) return;

        // Check URL parameter for log level override
        const params = new URLSearchParams(window.location.search);
        const logParam = params.get('log')?.toLowerCase();

        if (logParam) {
            switch (logParam) {
                case 'debug':
                case 'all':
                    Logger._level = LogLevel.DEBUG;
                    Logger._showTimestamps = true;
                    break;
                case 'info':
                    Logger._level = LogLevel.INFO;
                    break;
                case 'warn':
                    Logger._level = LogLevel.WARN;
                    break;
                case 'error':
                    Logger._level = LogLevel.ERROR;
                    break;
                case 'none':
                case 'off':
                    Logger._level = LogLevel.NONE;
                    break;
            }
        }

        // Check if we're in development (localhost or file://)
        const isDev = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      window.location.protocol === 'file:';

        // In development without explicit setting, default to INFO
        if (!logParam && isDev) {
            Logger._level = LogLevel.INFO;
        }

        Logger._initialized = true;

        // Log the current level if not NONE
        if (Logger._level < LogLevel.NONE) {
            const levelName = Object.keys(LogLevel).find(k => LogLevel[k] === Logger._level);
            console.info(`[Logger] Log level: ${levelName}${logParam ? ' (from URL)' : isDev ? ' (dev default)' : ' (prod default)'}`);
        }
    }

    /**
     * Set the global log level programmatically
     * @param {number} level - LogLevel value
     */
    static setLevel(level) {
        Logger._level = level;
    }

    /**
     * Get a logger instance for a specific module
     * @param {string} moduleName - Name of the module (used as prefix)
     * @returns {Object} Logger instance with debug, info, warn, error methods
     */
    static getLogger(moduleName) {
        if (!Logger._initialized) {
            Logger.init();
        }

        // Return cached logger if exists
        if (Logger._loggers.has(moduleName)) {
            return Logger._loggers.get(moduleName);
        }

        const prefix = `[${moduleName}]`;

        const logger = {
            /**
             * Log debug message (most verbose, for development)
             */
            debug: (...args) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    const timestamp = Logger._showTimestamps ? `[${new Date().toISOString().substr(11, 12)}] ` : '';
                    console.debug(timestamp + prefix, ...args);
                }
            },

            /**
             * Log info message (general information)
             */
            info: (...args) => {
                if (Logger._level <= LogLevel.INFO) {
                    console.info(prefix, ...args);
                }
            },

            /**
             * Log warning message
             */
            warn: (...args) => {
                if (Logger._level <= LogLevel.WARN) {
                    console.warn(prefix, ...args);
                }
            },

            /**
             * Log error message (always shown unless NONE)
             */
            error: (...args) => {
                if (Logger._level <= LogLevel.ERROR) {
                    console.error(prefix, ...args);
                }
            },

            /**
             * Log a group of related messages (collapsible in console)
             * @param {string} label - Group label
             * @param {Function} fn - Function that logs the group contents
             */
            group: (label, fn) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.groupCollapsed(prefix + ' ' + label);
                    fn();
                    console.groupEnd();
                }
            },

            /**
             * Log timing information
             * @param {string} label - Timer label
             */
            time: (label) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.time(prefix + ' ' + label);
                }
            },

            /**
             * End timing and log result
             * @param {string} label - Timer label (must match time() call)
             */
            timeEnd: (label) => {
                if (Logger._level <= LogLevel.DEBUG) {
                    console.timeEnd(prefix + ' ' + label);
                }
            }
        };

        Logger._loggers.set(moduleName, logger);
        return logger;
    }

    /**
     * Check if a log level is enabled
     * @param {number} level - LogLevel to check
     * @returns {boolean}
     */
    static isEnabled(level) {
        return Logger._level <= level;
    }
}

// Initialize on module load
Logger.init();

// =============================================================================
// ERROR HANDLING & NOTIFICATIONS
// =============================================================================

/**
 * Notification types for styling
 */
const NotificationType = {
    ERROR: 'error',
    WARNING: 'warning',
    SUCCESS: 'success',
    INFO: 'info'
};

/**
 * Centralized error and notification handler.
 * Provides user-friendly notifications instead of alert() dialogs.
 */
class NotificationManager {
    constructor() {
        this.container = null;
        this.queue = [];
        this.maxVisible = 3;
        this.defaultDuration = 5000; // 5 seconds
        this.initialized = false;
    }

    /**
     * Initialize the notification container in the DOM
     */
    init() {
        if (this.initialized) return;

        // Create notification container
        this.container = document.createElement('div');
        this.container.id = 'notification-container';
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 400px;
            pointer-events: none;
        `;
        document.body.appendChild(this.container);
        this.initialized = true;
    }

    /**
     * Show a notification to the user
     * @param {string} message - The message to display
     * @param {string} type - Notification type (error, warning, success, info)
     * @param {Object} options - Additional options
     * @param {number} options.duration - How long to show (ms), 0 for persistent
     * @param {boolean} options.log - Whether to also log to console (default: true)
     */
    show(message, type = NotificationType.INFO, options = {}) {
        const { duration = this.defaultDuration, log = true } = options;

        // Ensure initialized
        if (!this.initialized) {
            this.init();
        }

        // Log to console
        if (log) {
            const logMethod = type === NotificationType.ERROR ? 'error' :
                             type === NotificationType.WARNING ? 'warn' : 'info';
            console[logMethod](`[Notification] ${message}`);
        }

        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            pointer-events: auto;
            animation: slideIn 0.3s ease-out;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.4;
            max-width: 100%;
            word-wrap: break-word;
        `;

        // Type-specific styling
        const colors = {
            error: { bg: '#dc3545', border: '#c82333', icon: '\u2716' },
            warning: { bg: '#ffc107', border: '#e0a800', icon: '\u26A0', textColor: '#000' },
            success: { bg: '#28a745', border: '#218838', icon: '\u2714' },
            info: { bg: '#17a2b8', border: '#138496', icon: '\u2139' }
        };

        const colorConfig = colors[type] || colors.info;
        notification.style.backgroundColor = colorConfig.bg;
        notification.style.borderLeft = `4px solid ${colorConfig.border}`;
        notification.style.color = colorConfig.textColor || '#fff';

        // Create icon
        const icon = document.createElement('span');
        icon.textContent = colorConfig.icon;
        icon.style.cssText = 'font-size: 16px; flex-shrink: 0;';

        // Create message container
        const messageEl = document.createElement('span');
        messageEl.textContent = message;
        messageEl.style.flex = '1';

        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '\u00D7';
        closeBtn.style.cssText = `
            background: none;
            border: none;
            color: inherit;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            margin-left: 8px;
            opacity: 0.7;
            flex-shrink: 0;
        `;
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = () => this.remove(notification);

        notification.appendChild(icon);
        notification.appendChild(messageEl);
        notification.appendChild(closeBtn);

        // Add to container
        this.container.appendChild(notification);

        // Auto-remove after duration (if not persistent)
        if (duration > 0) {
            setTimeout(() => this.remove(notification), duration);
        }

        return notification;
    }

    /**
     * Remove a notification
     * @param {HTMLElement} notification - The notification element to remove
     */
    remove(notification) {
        if (!notification || !notification.parentNode) return;

        notification.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }

    /**
     * Show an error notification
     * @param {string} message - Error message
     * @param {Error} error - Optional error object for logging
     */
    error(message, error = null) {
        if (error) {
            console.error('[Error]', message, error);
        }
        return this.show(message, NotificationType.ERROR, { duration: 8000 });
    }

    /**
     * Show a warning notification
     * @param {string} message - Warning message
     */
    warning(message) {
        return this.show(message, NotificationType.WARNING, { duration: 6000 });
    }

    /**
     * Show a success notification
     * @param {string} message - Success message
     */
    success(message) {
        return this.show(message, NotificationType.SUCCESS, { duration: 4000 });
    }

    /**
     * Show an info notification
     * @param {string} message - Info message
     */
    info(message) {
        return this.show(message, NotificationType.INFO);
    }
}

// Add CSS animation keyframes
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Singleton instance
const notify = new NotificationManager();

// =============================================================================
// MESH PROCESSING UTILITIES
// =============================================================================

/**
 * Ensures a mesh has computed vertex normals for proper lighting.
 * @param {THREE.Mesh} mesh - The mesh to process
 */
function ensureMeshNormals(mesh) {
    if (mesh.geometry && !mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals();
    }
}

/**
 * Converts a material to MeshStandardMaterial for consistent PBR lighting.
 * Handles MeshBasicMaterial, LineBasicMaterial, and PointsMaterial conversions.
 *
 * @param {THREE.Material} material - The material to potentially convert
 * @param {Object} options - Conversion options
 * @param {boolean} options.preserveTextures - Whether to preserve texture maps (default: true)
 * @param {boolean} options.disposeOld - Whether to dispose the old material (default: true)
 * @returns {THREE.MeshStandardMaterial} - The converted or original material
 */
function convertToStandardMaterial(material, options = {}) {
    const { preserveTextures = true, disposeOld = true } = options;

    // Only convert non-PBR materials
    if (!material ||
        (!material.isMeshBasicMaterial &&
         !material.isLineBasicMaterial &&
         !material.isPointsMaterial)) {
        return material;
    }

    const oldMaterial = material;
    const newMaterial = new THREE.MeshStandardMaterial({
        color: oldMaterial.color?.clone() || new THREE.Color(COLORS.DEFAULT_MATERIAL),
        map: preserveTextures ? oldMaterial.map : null,
        alphaMap: preserveTextures ? oldMaterial.alphaMap : null,
        transparent: oldMaterial.transparent || false,
        opacity: oldMaterial.opacity !== undefined ? oldMaterial.opacity : MATERIAL.DEFAULT_OPACITY,
        side: oldMaterial.side || THREE.FrontSide,
        metalness: MATERIAL.DEFAULT_METALNESS,
        roughness: MATERIAL.DEFAULT_ROUGHNESS
    });

    if (disposeOld && oldMaterial.dispose) {
        oldMaterial.dispose();
    }

    return newMaterial;
}

/**
 * Creates a default MeshStandardMaterial with consistent settings.
 * Used for OBJ files without materials.
 *
 * @param {Object} options - Material options
 * @param {THREE.Color|number} options.color - Material color
 * @param {THREE.Texture} options.map - Diffuse texture map
 * @returns {THREE.MeshStandardMaterial}
 */
function createDefaultMaterial(options = {}) {
    const { color = COLORS.DEFAULT_MATERIAL, map = null } = options;

    return new THREE.MeshStandardMaterial({
        color: color instanceof THREE.Color ? color : new THREE.Color(color),
        map: map,
        metalness: MATERIAL.DEFAULT_METALNESS,
        roughness: MATERIAL.DEFAULT_ROUGHNESS
    });
}

/**
 * Processes all meshes in a 3D object, ensuring proper normals and materials.
 * This is the main utility function that consolidates duplicate traverse code.
 *
 * @param {THREE.Object3D} object - The 3D object to process
 * @param {Object} options - Processing options
 * @param {boolean} options.upgradeBasicMaterials - Convert basic materials to standard (default: true)
 * @param {boolean} options.forceDefaultMaterial - Replace all materials with default (default: false)
 * @param {boolean} options.preserveTextures - Keep texture maps when converting (default: true)
 */
function processMeshMaterials(object, options = {}) {
    const {
        upgradeBasicMaterials = true,
        forceDefaultMaterial = false,
        preserveTextures = true
    } = options;

    object.traverse((child) => {
        if (!child.isMesh) return;

        // Ensure normals exist for proper lighting
        ensureMeshNormals(child);

        // Handle material conversion
        if (forceDefaultMaterial) {
            // Replace with default material (for OBJ without MTL)
            const oldMaterial = child.material;
            const color = oldMaterial?.color?.clone() || new THREE.Color(COLORS.DEFAULT_MATERIAL);
            const map = preserveTextures ? oldMaterial?.map : null;

            child.material = createDefaultMaterial({ color, map });

            if (oldMaterial && oldMaterial.dispose) {
                oldMaterial.dispose();
            }
        } else if (upgradeBasicMaterials && child.material) {
            // Upgrade basic materials to standard for better lighting
            child.material = convertToStandardMaterial(child.material, { preserveTextures });
        }
    });
}

/**
 * Counts the total number of faces in a 3D object.
 *
 * @param {THREE.Object3D} object - The 3D object to analyze
 * @returns {number} - Total face count
 */
function computeMeshFaceCount(object) {
    let faceCount = 0;

    object.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            if (geo.index) {
                faceCount += geo.index.count / 3;
            } else if (geo.attributes.position) {
                faceCount += geo.attributes.position.count / 3;
            }
        }
    });

    return Math.round(faceCount);
}

/**
 * Counts the total number of vertices in a 3D object.
 *
 * @param {THREE.Object3D} object - The 3D object to analyze
 * @returns {number} - Total vertex count
 */
function computeMeshVertexCount(object) {
    let vertexCount = 0;

    object.traverse((child) => {
        if (child.isMesh && child.geometry && child.geometry.attributes.position) {
            vertexCount += child.geometry.attributes.position.count;
        }
    });

    return vertexCount;
}

/**
 * Disposes of all geometries and materials in a 3D object.
 * Useful for cleanup when removing objects from the scene.
 *
 * @param {THREE.Object3D} object - The object to dispose
 */
function disposeObject(object) {
    object.traverse((child) => {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    if (m.dispose) m.dispose();
                });
            } else if (child.material.dispose) {
                child.material.dispose();
            }
        }
    });
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    // Logging system
    Logger,
    LogLevel,

    // Notification system
    notify,
    NotificationType,

    // Mesh utilities
    processMeshMaterials,
    ensureMeshNormals,
    convertToStandardMaterial,
    createDefaultMaterial,
    computeMeshFaceCount,
    computeMeshVertexCount,
    disposeObject
};
