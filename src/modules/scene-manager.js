/**
 * Scene Manager Module
 *
 * Handles Three.js scene setup and rendering:
 * - Scene, camera, renderer initialization
 * - Lighting setup
 * - Grid helper
 * - Split view rendering
 * - Animation loop
 * - FPS counter
 * - Window resize handling
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CAMERA, ORBIT_CONTROLS, RENDERER, LIGHTING, GRID, COLORS } from './constants.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('scene-manager');

// =============================================================================
// SCENE MANAGER CLASS
// =============================================================================

/**
 * Manages the Three.js scene, camera, renderers, and animation loop.
 */
export class SceneManager {
    constructor() {
        // Three.js core objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererRight = null;
        this.controls = null;
        this.controlsRight = null;
        this.transformControls = null;

        // Lighting
        this.ambientLight = null;
        this.hemisphereLight = null;
        this.directionalLight1 = null;
        this.directionalLight2 = null;

        // Grid
        this.gridHelper = null;

        // Model group
        this.modelGroup = null;

        // Point cloud group
        this.pointcloudGroup = null;

        // FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();

        // Callbacks
        this.onTransformChange = null;
        this.onDraggingChanged = null;
    }

    /**
     * Initialize the scene with all components
     * @param {HTMLCanvasElement} canvas - Main canvas element
     * @param {HTMLCanvasElement} canvasRight - Right canvas for split view
     * @returns {boolean} Success status
     */
    init(canvas, canvasRight) {
        if (!canvas) {
            log.error('FATAL: Main canvas not found!');
            return false;
        }
        if (!canvasRight) {
            log.error('FATAL: Right canvas not found!');
            return false;
        }

        log.info('Initializing scene...');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(COLORS.SCENE_BACKGROUND);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            CAMERA.FOV,
            canvas.clientWidth / canvas.clientHeight,
            CAMERA.NEAR,
            CAMERA.FAR
        );
        this.camera.position.set(
            CAMERA.INITIAL_POSITION.x,
            CAMERA.INITIAL_POSITION.y,
            CAMERA.INITIAL_POSITION.z
        );

        // Main Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Right Renderer (for split view)
        this.rendererRight = new THREE.WebGLRenderer({
            canvas: canvasRight,
            antialias: true
        });
        this.rendererRight.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
        this.rendererRight.outputColorSpace = THREE.SRGBColorSpace;

        // Orbit Controls - Main
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
        this.controls.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;
        // Explicit mouse mapping: left=orbit, middle=zoom, right=pan
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        this.controls.rotateSpeed = 1.0;

        // Orbit Controls - Right
        this.controlsRight = new OrbitControls(this.camera, this.rendererRight.domElement);
        this.controlsRight.enableDamping = true;
        this.controlsRight.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
        this.controlsRight.screenSpacePanning = true;
        this.controlsRight.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
        this.controlsRight.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;
        this.controlsRight.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        this.controlsRight.rotateSpeed = 1.0;

        // Transform Controls
        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event) => {
            this.controls.enabled = !event.value;
            this.controlsRight.enabled = !event.value;
            if (this.onDraggingChanged) {
                this.onDraggingChanged(event.value);
            }
        });
        this.transformControls.addEventListener('objectChange', () => {
            if (this.onTransformChange) {
                this.onTransformChange();
            }
        });

        // Add TransformControls to scene
        log.info('TransformControls instanceof THREE.Object3D:', this.transformControls instanceof THREE.Object3D);
        if (!(this.transformControls instanceof THREE.Object3D)) {
            log.error('WARNING: TransformControls is NOT an instance of THREE.Object3D!');
            log.error('This indicates THREE.js is loaded multiple times (import map issue).');
        }
        try {
            this.scene.add(this.transformControls);
            log.info('TransformControls added to scene successfully');
        } catch (tcError) {
            log.error('Failed to add TransformControls to scene:', tcError);
            log.error('Transform gizmos will not be visible, but app should still work');
        }

        // Setup lighting
        this.setupLighting();

        // Model group
        this.modelGroup = new THREE.Group();
        this.modelGroup.name = 'modelGroup';
        this.scene.add(this.modelGroup);

        this.pointcloudGroup = new THREE.Group();
        this.pointcloudGroup.name = 'pointcloudGroup';
        this.scene.add(this.pointcloudGroup);

        log.info('Scene initialization complete');
        return true;
    }

    /**
     * Setup scene lighting
     */
    setupLighting() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(
            LIGHTING.AMBIENT.COLOR,
            LIGHTING.AMBIENT.INTENSITY
        );
        this.scene.add(this.ambientLight);

        // Hemisphere light
        this.hemisphereLight = new THREE.HemisphereLight(
            LIGHTING.HEMISPHERE.SKY_COLOR,
            LIGHTING.HEMISPHERE.GROUND_COLOR,
            LIGHTING.HEMISPHERE.INTENSITY
        );
        this.scene.add(this.hemisphereLight);

        // Directional light 1
        this.directionalLight1 = new THREE.DirectionalLight(
            LIGHTING.DIRECTIONAL_1.COLOR,
            LIGHTING.DIRECTIONAL_1.INTENSITY
        );
        this.directionalLight1.position.set(
            LIGHTING.DIRECTIONAL_1.POSITION.x,
            LIGHTING.DIRECTIONAL_1.POSITION.y,
            LIGHTING.DIRECTIONAL_1.POSITION.z
        );
        this.scene.add(this.directionalLight1);

        // Directional light 2
        this.directionalLight2 = new THREE.DirectionalLight(
            LIGHTING.DIRECTIONAL_2.COLOR,
            LIGHTING.DIRECTIONAL_2.INTENSITY
        );
        this.directionalLight2.position.set(
            LIGHTING.DIRECTIONAL_2.POSITION.x,
            LIGHTING.DIRECTIONAL_2.POSITION.y,
            LIGHTING.DIRECTIONAL_2.POSITION.z
        );
        this.scene.add(this.directionalLight2);

        log.info('Lighting setup complete');
    }

    /**
     * Toggle grid visibility
     * @param {boolean} show - Whether to show the grid
     */
    toggleGrid(show) {
        if (show && !this.gridHelper) {
            this.gridHelper = new THREE.GridHelper(
                GRID.SIZE,
                GRID.DIVISIONS,
                GRID.COLOR_PRIMARY,
                GRID.COLOR_SECONDARY
            );
            this.gridHelper.position.y = GRID.Y_OFFSET;
            this.scene.add(this.gridHelper);
        } else if (!show && this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }
    }

    /**
     * Set scene background color
     * @param {string} hexColor - Hex color string
     */
    setBackgroundColor(hexColor) {
        const color = new THREE.Color(hexColor);
        this.scene.background = color;
        document.documentElement.style.setProperty('--scene-bg-color', hexColor);
    }

    /**
     * Handle window resize
     * @param {string} displayMode - Current display mode ('split' or other)
     * @param {HTMLElement} container - Viewer container element
     */
    onWindowResize(displayMode, container) {
        if (displayMode === 'split') {
            const halfWidth = container.clientWidth / 2;
            this.camera.aspect = halfWidth / container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(halfWidth, container.clientHeight);
            this.rendererRight.setSize(halfWidth, container.clientHeight);
        } else {
            this.camera.aspect = container.clientWidth / container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(container.clientWidth, container.clientHeight);
        }
    }

    /**
     * Update light intensity
     * @param {string} lightType - 'ambient', 'hemisphere', 'directional1', 'directional2'
     * @param {number} intensity - New intensity value
     */
    setLightIntensity(lightType, intensity) {
        switch (lightType) {
            case 'ambient':
                if (this.ambientLight) this.ambientLight.intensity = intensity;
                break;
            case 'hemisphere':
                if (this.hemisphereLight) this.hemisphereLight.intensity = intensity;
                break;
            case 'directional1':
                if (this.directionalLight1) this.directionalLight1.intensity = intensity;
                break;
            case 'directional2':
                if (this.directionalLight2) this.directionalLight2.intensity = intensity;
                break;
        }
    }

    /**
     * Set transform controls mode
     * @param {string} mode - 'translate', 'rotate', or 'scale'
     */
    setTransformMode(mode) {
        this.transformControls.setMode(mode);
    }

    /**
     * Attach transform controls to an object
     * @param {THREE.Object3D} object - Object to attach to
     */
    attachTransformControls(object) {
        try {
            this.transformControls.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }

        if (object) {
            try {
                this.transformControls.attach(object);
            } catch (attachError) {
                log.error('Error attaching transform controls:', attachError);
            }
        }
    }

    /**
     * Detach transform controls
     */
    detachTransformControls() {
        try {
            this.transformControls.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }
    }

    /**
     * Update FPS counter
     * @param {HTMLElement} fpsElement - Element to display FPS
     */
    updateFPS(fpsElement) {
        this.frameCount++;
        const currentTime = performance.now();
        if (currentTime - this.lastFpsTime >= 1000) {
            if (fpsElement) {
                fpsElement.textContent = this.frameCount;
            }
            this.frameCount = 0;
            this.lastFpsTime = currentTime;
        }
    }

    /**
     * Render a single frame
     * @param {string} displayMode - Current display mode
     * @param {THREE.Object3D} splatMesh - Splat mesh object
     * @param {THREE.Group} modelGroup - Model group object
     * @param {THREE.Group} pointcloudGroup - Point cloud group object
     */
    render(displayMode, splatMesh, modelGroup, pointcloudGroup) {
        if (displayMode === 'split') {
            // Split view - render splat on left, model + pointcloud on right
            const splatVisible = splatMesh ? splatMesh.visible : false;
            const modelVisible = modelGroup ? modelGroup.visible : false;
            const pcVisible = pointcloudGroup ? pointcloudGroup.visible : false;

            // Left view - splat only
            if (splatMesh) splatMesh.visible = true;
            if (modelGroup) modelGroup.visible = false;
            if (pointcloudGroup) pointcloudGroup.visible = false;
            this.renderer.render(this.scene, this.camera);

            // Right view - model + pointcloud
            if (splatMesh) splatMesh.visible = false;
            if (modelGroup) modelGroup.visible = true;
            if (pointcloudGroup) pointcloudGroup.visible = true;
            this.rendererRight.render(this.scene, this.camera);

            // Restore visibility
            if (splatMesh) splatMesh.visible = splatVisible;
            if (modelGroup) modelGroup.visible = modelVisible;
            if (pointcloudGroup) pointcloudGroup.visible = pcVisible;
        } else {
            // Normal view
            this.renderer.render(this.scene, this.camera);
        }
    }

    /**
     * Add an object to the scene
     * @param {THREE.Object3D} object - Object to add
     */
    addToScene(object) {
        this.scene.add(object);
    }

    /**
     * Remove an object from the scene
     * @param {THREE.Object3D} object - Object to remove
     */
    removeFromScene(object) {
        this.scene.remove(object);
    }

    /**
     * Dispose of scene resources
     */
    dispose() {
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }

        if (this.transformControls) {
            this.scene.remove(this.transformControls);
            this.transformControls.dispose();
        }

        if (this.controls) {
            this.controls.dispose();
        }

        if (this.controlsRight) {
            this.controlsRight.dispose();
        }

        if (this.renderer) {
            this.renderer.dispose();
        }

        if (this.rendererRight) {
            this.rendererRight.dispose();
        }

        log.info('Scene manager disposed');
    }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create and initialize a scene manager
 * @param {HTMLCanvasElement} canvas - Main canvas element
 * @param {HTMLCanvasElement} canvasRight - Right canvas for split view
 * @returns {SceneManager|null} Initialized scene manager or null on failure
 */
export function createSceneManager(canvas, canvasRight) {
    const manager = new SceneManager();
    const success = manager.init(canvas, canvasRight);
    return success ? manager : null;
}

export default SceneManager;
