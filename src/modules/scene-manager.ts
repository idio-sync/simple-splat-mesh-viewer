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
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    AmbientLight,
    HemisphereLight,
    DirectionalLight,
    GridHelper,
    Group,
    Color,
    Texture,
    PMREMGenerator,
    Mesh,
    ShadowMaterial,
    Object3D,
    PlaneGeometry,
    ToneMapping,
    Vector2,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';

// Dynamically loaded when WebGPU is available — prevents Firefox crash
// (static import of three/webgpu evaluates GPUShaderStage at load time)
let WebGPURendererClass: typeof WebGPURenderer | null = null;
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { CAMERA, ORBIT_CONTROLS, RENDERER, LIGHTING, GRID, COLORS, SHADOWS } from './constants.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('scene-manager');

// =============================================================================
// CALLBACK TYPES
// =============================================================================

type TransformChangeCallback = () => void;
type DraggingChangedCallback = (isDragging: boolean) => void;

// =============================================================================
// SCENE MANAGER CLASS
// =============================================================================

/**
 * Manages the Three.js scene, camera, renderers, and animation loop.
 */
export class SceneManager {
    // Three.js core objects
    scene: Scene | null;
    camera: PerspectiveCamera | null;
    renderer: any; // WebGLRenderer | WebGPURenderer — widened for Spark.js compat
    rendererRight: any; // WebGLRenderer | WebGPURenderer
    controls: OrbitControls | null;
    controlsRight: OrbitControls | null;
    transformControls: TransformControls | null;

    // Renderer type tracking
    rendererType: 'webgpu' | 'webgl';
    webgpuSupported: boolean;
    private _canvas: HTMLCanvasElement | null;
    private _canvasRight: HTMLCanvasElement | null;
    private _antialias: boolean;
    onRendererChanged: ((renderer: any) => void) | null;

    // Lighting
    ambientLight: AmbientLight | null;
    hemisphereLight: HemisphereLight | null;
    directionalLight1: DirectionalLight | null;
    directionalLight2: DirectionalLight | null;

    // Grid
    gridHelper: GridHelper | null;

    // Environment
    pmremGenerator: PMREMGenerator | null;
    currentEnvTexture: Texture | null;
    currentEnvMap: Texture | null;
    envAsBackground: boolean;
    savedBackgroundColor: Color | null;

    // Shadow catcher
    shadowCatcherPlane: Mesh<PlaneGeometry, ShadowMaterial> | null;

    // Background image
    backgroundImageTexture: Texture | null;

    // Model group
    modelGroup: Group | null;

    // Point cloud group
    pointcloudGroup: Group | null;

    // STL group
    stlGroup: Group | null;

    // FPS tracking
    frameCount: number;
    lastFpsTime: number;
    lastFPS: number;

    // Callbacks
    onTransformChange: TransformChangeCallback | null;
    onDraggingChanged: DraggingChangedCallback | null;

    constructor() {
        // Three.js core objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.rendererRight = null;
        this.controls = null;
        this.controlsRight = null;
        this.transformControls = null;

        // Renderer type tracking
        this.rendererType = 'webgl';
        this.webgpuSupported = false;
        this._canvas = null;
        this._canvasRight = null;
        this._antialias = true;
        this.onRendererChanged = null;

        // Lighting
        this.ambientLight = null;
        this.hemisphereLight = null;
        this.directionalLight1 = null;
        this.directionalLight2 = null;

        // Grid
        this.gridHelper = null;

        // Environment
        this.pmremGenerator = null;
        this.currentEnvTexture = null;
        this.currentEnvMap = null;
        this.envAsBackground = false;
        this.savedBackgroundColor = null;

        // Shadow catcher
        this.shadowCatcherPlane = null;

        // Background image
        this.backgroundImageTexture = null;

        // Model group
        this.modelGroup = null;

        // Point cloud group
        this.pointcloudGroup = null;

        // STL group
        this.stlGroup = null;

        // FPS tracking
        this.frameCount = 0;
        this.lastFpsTime = performance.now();
        this.lastFPS = 0;

        // Callbacks
        this.onTransformChange = null;
        this.onDraggingChanged = null;
    }

    /**
     * Create a renderer of the specified type on the given canvas,
     * applying standard settings (pixel ratio, color space, tone mapping, shadows).
     * For WebGPU, the caller must also call `await renderer.init()` after this.
     */
    /**
     * Patch a WebGPU renderer's backend to work around a Three.js bug where
     * render target textures are re-created without being destroyed first,
     * causing "WebGPUTextureUtils: Texture already initialized" errors.
     */
    private _patchWebGPURenderer(renderer: any): void {
        try {
            const backend = renderer.backend;
            if (!backend || !backend.textureUtils) return;
            const origCreate = backend.textureUtils.createTexture.bind(backend.textureUtils);
            backend.textureUtils.createTexture = function(texture: any, options: any) {
                const textureData = backend.get(texture);
                if (textureData.initialized) {
                    backend.textureUtils.destroyTexture(texture);
                }
                return origCreate(texture, options);
            };
            log.info('Patched WebGPU renderer texture lifecycle');
        } catch (e) {
            log.warn('Failed to patch WebGPU renderer:', e);
        }
    }

    private _createRenderer(canvas: HTMLCanvasElement, type: 'webgpu' | 'webgl'): any {
        let newRenderer: any;
        if (type === 'webgpu') {
            newRenderer = new WebGPURendererClass!({ canvas, antialias: this._antialias });
        } else {
            newRenderer = new WebGLRenderer({ canvas, antialias: this._antialias });
        }
        newRenderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
        newRenderer.outputColorSpace = THREE.SRGBColorSpace;
        newRenderer.toneMapping = THREE.NoToneMapping;
        newRenderer.toneMappingExposure = 1.0;
        // Only configure shadow map on WebGL — WebGPU has texture init bugs with shadow maps
        if (type === 'webgl') {
            newRenderer.shadowMap.enabled = false;
            newRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
        }
        return newRenderer;
    }

    /**
     * Initialize the scene with all components.
     * Async because WebGPURenderer requires `await renderer.init()`.
     */
    async init(canvas: HTMLCanvasElement, canvasRight: HTMLCanvasElement): Promise<boolean> {
        if (!canvas) {
            log.error('FATAL: Main canvas not found!');
            return false;
        }
        if (!canvasRight) {
            log.error('FATAL: Right canvas not found!');
            return false;
        }

        log.info('Initializing scene...');

        // Store canvas references
        this._canvas = canvas;
        this._canvasRight = canvasRight;

        // Detect WebGPU support and lazily load the renderer module
        // (preserve false if explicitly disabled before init)
        if (this.webgpuSupported !== false) {
            this.webgpuSupported = !!navigator.gpu;
        }
        log.info('WebGPU supported:', this.webgpuSupported);
        if (this.webgpuSupported && !WebGPURendererClass) {
            try {
                const mod = await import('three/webgpu');
                WebGPURendererClass = mod.WebGPURenderer;
            } catch (err) {
                log.warn('Failed to load WebGPU module, falling back to WebGL:', err);
                this.webgpuSupported = false;
            }
        }

        // Scene
        this.scene = new Scene();
        this.scene.background = new Color(COLORS.SCENE_BACKGROUND);

        // Camera
        this.camera = new PerspectiveCamera(
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

        // Choose renderer type: WebGPU if supported, else WebGL
        let useWebGPU = this.webgpuSupported;
        let rendererTypeToCreate = useWebGPU ? 'webgpu' : 'webgl';

        // Main Renderer with WebGPU fallback to WebGL on init failure
        this.renderer = this._createRenderer(canvas, rendererTypeToCreate);
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        if (useWebGPU) {
            try {
                await (this.renderer as WebGPURenderer).init();
                this._patchWebGPURenderer(this.renderer);
            } catch (err) {
                log.warn('WebGPU initialization failed, falling back to WebGL:', err);
                this.renderer.dispose();
                useWebGPU = false;
                rendererTypeToCreate = 'webgl';
                this.webgpuSupported = false;
                this.renderer = this._createRenderer(canvas, rendererTypeToCreate);
                this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
            }
        }
        this.rendererType = rendererTypeToCreate;
        log.info('Main renderer created:', this.rendererType);

        // Right Renderer (for split view)
        this.rendererRight = this._createRenderer(canvasRight, rendererTypeToCreate);
        if (useWebGPU) {
            try {
                await (this.rendererRight as WebGPURenderer).init();
                this._patchWebGPURenderer(this.rendererRight);
            } catch (err) {
                log.warn('WebGPU initialization failed for right renderer, falling back to WebGL:', err);
                this.rendererRight.dispose();
                this.rendererRight = this._createRenderer(canvasRight, 'webgl');
            }
        }

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
        // Touch: one finger orbits, two fingers pinch-zoom + pan
        this.controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
        this.controls.rotateSpeed = 1.0;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = ORBIT_CONTROLS.AUTO_ROTATE_SPEED;

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
        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            this.controls!.enabled = !event.value;
            this.controlsRight!.enabled = !event.value;
            if (this.onDraggingChanged) {
                this.onDraggingChanged(event.value);
            }
        });
        this.transformControls.addEventListener('objectChange', () => {
            if (this.onTransformChange) {
                this.onTransformChange();
            }
        });

        // Add TransformControls helper to scene
        // In Three.js 0.170+, TransformControls extends Controls (not Object3D).
        // The renderable gizmo is accessed via getHelper().
        try {
            const helper = this.transformControls.getHelper();
            helper.visible = false; // Hidden until Transform tool is activated
            this.transformControls.enabled = false;
            this.scene.add(helper);
            log.info('TransformControls helper added to scene successfully');
        } catch (tcError) {
            log.error('Failed to add TransformControls helper to scene:', tcError);
            log.error('Transform gizmos will not be visible, but app should still work');
        }

        // Setup lighting
        this.setupLighting();

        // Model group
        this.modelGroup = new Group();
        this.modelGroup.name = 'modelGroup';
        this.scene.add(this.modelGroup);

        this.pointcloudGroup = new Group();
        this.pointcloudGroup.name = 'pointcloudGroup';
        this.scene.add(this.pointcloudGroup);

        this.stlGroup = new Group();
        this.stlGroup.name = 'stlGroup';
        this.scene.add(this.stlGroup);

        log.info('Scene initialization complete');
        return true;
    }

    /**
     * Switch between WebGPU and WebGL renderers.
     * Replaces the canvas in the DOM, recreates controls, and fires onRendererChanged.
     */
    async switchRenderer(target: 'webgpu' | 'webgl', force = false): Promise<void> {
        // No-op guards
        if (this.rendererType === target && !force) return;
        if (target === 'webgpu' && !this.webgpuSupported) return;

        // Ensure WebGPU module is loaded if switching to it
        if (target === 'webgpu' && !WebGPURendererClass) {
            try {
                const mod = await import('three/webgpu');
                WebGPURendererClass = mod.WebGPURenderer;
            } catch (err) {
                log.warn('Failed to load WebGPU module:', err);
                this.webgpuSupported = false;
                return;
            }
        }

        log.info(`Switching renderer: ${this.rendererType} -> ${target}`);

        // Save current renderer state
        const size = new Vector2();
        this.renderer.getSize(size);
        const pixelRatio = this.renderer.getPixelRatio();
        const toneMapping = this.renderer.toneMapping;
        const toneMappingExposure = this.renderer.toneMappingExposure;
        const shadowMapEnabled = this.renderer.shadowMap.enabled;
        const shadowMapType = this.renderer.shadowMap.type;
        const outputColorSpace = this.renderer.outputColorSpace;

        // Save orbit controls state
        const controlsTarget = this.controls!.target.clone();
        const controlsDamping = this.controls!.enableDamping;
        const controlsAutoRotate = this.controls!.autoRotate;
        const controlsAutoRotateSpeed = this.controls!.autoRotateSpeed;

        // --- Dispose old main renderer + controls ---
        this.controls!.dispose();
        this.controlsRight!.dispose();

        // Remove TransformControls listeners and detach before dispose
        if (this.transformControls) {
            try { this.transformControls.detach(); } catch { /* ignore */ }
            this.scene!.remove(this.transformControls.getHelper());
            this.transformControls.dispose();
        }

        const wasWebGPU = this.rendererType === 'webgpu';
        this.renderer.dispose();
        this.rendererRight.dispose();

        // After disposing WebGPU renderers, the GPU device destruction is async.
        // Browsers (especially Firefox) may fail to create WebGL contexts until
        // the GPU resources are fully released, so yield to let cleanup complete.
        if (wasWebGPU && target === 'webgl') {
            await new Promise(r => setTimeout(r, 100));
        }

        // --- Replace main canvas in DOM ---
        const oldCanvas = this._canvas!;
        const newCanvas = document.createElement('canvas');
        newCanvas.id = oldCanvas.id;
        newCanvas.className = oldCanvas.className;
        newCanvas.style.cssText = oldCanvas.style.cssText;
        oldCanvas.parentNode!.replaceChild(newCanvas, oldCanvas);
        this._canvas = newCanvas;

        // --- Replace right canvas in DOM ---
        const oldCanvasRight = this._canvasRight!;
        const newCanvasRight = document.createElement('canvas');
        newCanvasRight.id = oldCanvasRight.id;
        newCanvasRight.className = oldCanvasRight.className;
        newCanvasRight.style.cssText = oldCanvasRight.style.cssText;
        oldCanvasRight.parentNode!.replaceChild(newCanvasRight, oldCanvasRight);
        this._canvasRight = newCanvasRight;

        // --- Create new renderers (with retry for WebGPU→WebGL transitions) ---
        const createWithRetry = async (canvas: HTMLCanvasElement): Promise<any> => {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    return this._createRenderer(canvas, target);
                } catch (err) {
                    if (attempt < 2 && target === 'webgl' && wasWebGPU) {
                        log.warn(`WebGL context creation failed (attempt ${attempt + 1}/3), retrying...`);
                        await new Promise(r => setTimeout(r, 200));
                    } else {
                        throw err;
                    }
                }
            }
        };

        this.renderer = await createWithRetry(newCanvas);
        this.renderer.setSize(size.x, size.y);
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.toneMapping = toneMapping;
        this.renderer.toneMappingExposure = toneMappingExposure;
        // Only restore shadow state on WebGL — WebGPU has a shadow map texture bug
        if (target === 'webgl') {
            this.renderer.shadowMap.enabled = shadowMapEnabled;
            this.renderer.shadowMap.type = shadowMapType;
        }
        this.renderer.outputColorSpace = outputColorSpace;
        if (target === 'webgpu') {
            await (this.renderer as WebGPURenderer).init();
            this._patchWebGPURenderer(this.renderer);
        }

        this.rendererRight = await createWithRetry(newCanvasRight);
        this.rendererRight.setPixelRatio(pixelRatio);
        this.rendererRight.toneMapping = toneMapping;
        this.rendererRight.toneMappingExposure = toneMappingExposure;
        // Only restore shadow state on WebGL — WebGPU has a shadow map texture bug
        if (target === 'webgl') {
            this.rendererRight.shadowMap.enabled = shadowMapEnabled;
            this.rendererRight.shadowMap.type = shadowMapType;
        }
        this.rendererRight.outputColorSpace = outputColorSpace;
        if (target === 'webgpu') {
            await (this.rendererRight as WebGPURenderer).init();
            this._patchWebGPURenderer(this.rendererRight);
        }

        // --- Recreate OrbitControls ---
        this.controls = new OrbitControls(this.camera!, this.renderer.domElement);
        this.controls.enableDamping = controlsDamping;
        this.controls.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
        this.controls.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN
        };
        this.controls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN
        };
        this.controls.rotateSpeed = 1.0;
        this.controls.autoRotate = controlsAutoRotate;
        this.controls.autoRotateSpeed = controlsAutoRotateSpeed;
        this.controls.target.copy(controlsTarget);

        this.controlsRight = new OrbitControls(this.camera!, this.rendererRight.domElement);
        this.controlsRight.enableDamping = controlsDamping;
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
        this.controlsRight.target.copy(controlsTarget);

        // --- Recreate TransformControls ---
        this.transformControls = new TransformControls(this.camera!, this.renderer.domElement);
        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            this.controls!.enabled = !event.value;
            this.controlsRight!.enabled = !event.value;
            if (this.onDraggingChanged) {
                this.onDraggingChanged(event.value);
            }
        });
        this.transformControls.addEventListener('objectChange', () => {
            if (this.onTransformChange) {
                this.onTransformChange();
            }
        });
        try {
            this.scene!.add(this.transformControls.getHelper());
        } catch {
            log.warn('Failed to re-add TransformControls helper to scene after renderer switch');
        }

        // --- Recreate PMREMGenerator if an env map is active ---
        if (this.currentEnvMap && this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = new PMREMGenerator(this.renderer);
            this.pmremGenerator.compileEquirectangularShader();
            if (this.currentEnvTexture) {
                const oldEnvMap = this.currentEnvMap;
                this.currentEnvMap = this.pmremGenerator.fromEquirectangular(this.currentEnvTexture).texture;
                this.scene!.environment = this.currentEnvMap;
                oldEnvMap.dispose();
            }
        }

        // Update state
        this.rendererType = target;

        // Fire callback
        if (this.onRendererChanged) {
            this.onRendererChanged(this.renderer);
        }

        log.info(`Renderer switched to ${target}`);
    }

    /**
     * Ensure the renderer is WebGL (for Spark.js Gaussian splat compatibility).
     * No-op if already WebGL.
     */
    async ensureWebGLRenderer(): Promise<void> {
        if (this.rendererType !== 'webgl') {
            await this.switchRenderer('webgl');
        }
    }

    /**
     * Ensure the renderer is WebGPU (for better performance).
     * No-op if already WebGPU or if WebGPU is not supported.
     */
    async ensureWebGPURenderer(): Promise<void> {
        if (this.rendererType !== 'webgpu') {
            await this.switchRenderer('webgpu');
        }
    }

    /**
     * Enable or disable hardware antialiasing.
     * Requires renderer recreation (WebGL AA is a context-creation flag).
     * No-op if the value hasn't changed.
     */
    async setAntialias(enabled: boolean): Promise<void> {
        if (enabled === this._antialias) return;
        this._antialias = enabled;
        log.info(`Antialiasing ${enabled ? 'enabled' : 'disabled'}, recreating renderer`);
        await this.switchRenderer(this.rendererType, true);
    }

    /**
     * Setup scene lighting
     */
    setupLighting(): void {
        // Ambient light
        this.ambientLight = new AmbientLight(
            LIGHTING.AMBIENT.COLOR,
            LIGHTING.AMBIENT.INTENSITY
        );
        this.scene!.add(this.ambientLight);

        // Hemisphere light
        this.hemisphereLight = new HemisphereLight(
            LIGHTING.HEMISPHERE.SKY_COLOR,
            LIGHTING.HEMISPHERE.GROUND_COLOR,
            LIGHTING.HEMISPHERE.INTENSITY
        );
        this.scene!.add(this.hemisphereLight);

        // Directional light 1
        this.directionalLight1 = new DirectionalLight(
            LIGHTING.DIRECTIONAL_1.COLOR,
            LIGHTING.DIRECTIONAL_1.INTENSITY
        );
        this.directionalLight1.position.set(
            LIGHTING.DIRECTIONAL_1.POSITION.x,
            LIGHTING.DIRECTIONAL_1.POSITION.y,
            LIGHTING.DIRECTIONAL_1.POSITION.z
        );
        this.directionalLight1.castShadow = false;
        this.directionalLight1.shadow.mapSize.width = SHADOWS.MAP_SIZE;
        this.directionalLight1.shadow.mapSize.height = SHADOWS.MAP_SIZE;
        this.directionalLight1.shadow.camera.near = SHADOWS.CAMERA_NEAR;
        this.directionalLight1.shadow.camera.far = SHADOWS.CAMERA_FAR;
        this.directionalLight1.shadow.camera.left = -SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.right = SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.top = SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.camera.bottom = -SHADOWS.CAMERA_SIZE;
        this.directionalLight1.shadow.bias = SHADOWS.BIAS;
        this.directionalLight1.shadow.normalBias = SHADOWS.NORMAL_BIAS;
        this.scene!.add(this.directionalLight1);

        // Directional light 2
        this.directionalLight2 = new DirectionalLight(
            LIGHTING.DIRECTIONAL_2.COLOR,
            LIGHTING.DIRECTIONAL_2.INTENSITY
        );
        this.directionalLight2.position.set(
            LIGHTING.DIRECTIONAL_2.POSITION.x,
            LIGHTING.DIRECTIONAL_2.POSITION.y,
            LIGHTING.DIRECTIONAL_2.POSITION.z
        );
        this.scene!.add(this.directionalLight2);

        log.info('Lighting setup complete');
    }

    /**
     * Toggle grid visibility
     */
    toggleGrid(show: boolean): void {
        if (show && !this.gridHelper) {
            this.gridHelper = new GridHelper(
                GRID.SIZE,
                GRID.DIVISIONS,
                GRID.COLOR_PRIMARY,
                GRID.COLOR_SECONDARY
            );
            this.gridHelper.position.y = GRID.Y_OFFSET;
            this.scene!.add(this.gridHelper);
        } else if (!show && this.gridHelper) {
            this.scene!.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }
    }

    /**
     * Set scene background color
     */
    setBackgroundColor(hexColor: string): void {
        const color = new Color(hexColor);
        this.scene!.background = color;
        this.savedBackgroundColor = color.clone();
        this.envAsBackground = false;
        this.clearBackgroundImage();
        document.documentElement.style.setProperty('--scene-bg-color', hexColor);
    }

    // =========================================================================
    // TONE MAPPING
    // =========================================================================

    /**
     * Set tone mapping algorithm
     */
    setToneMapping(type: string): void {
        const mappings: Record<string, ToneMapping> = {
            'None': THREE.NoToneMapping,
            'Linear': THREE.LinearToneMapping,
            'Reinhard': THREE.ReinhardToneMapping,
            'Cineon': THREE.CineonToneMapping,
            'ACESFilmic': THREE.ACESFilmicToneMapping,
            'AgX': THREE.AgXToneMapping
        };
        const mapping = mappings[type] || THREE.NoToneMapping;
        this.renderer!.toneMapping = mapping;
        this.rendererRight!.toneMapping = mapping;
    }

    /**
     * Set tone mapping exposure
     */
    setToneMappingExposure(value: number): void {
        this.renderer!.toneMappingExposure = value;
        this.rendererRight!.toneMappingExposure = value;
    }

    // =========================================================================
    // HDR ENVIRONMENT MAPS (IBL)
    // =========================================================================

    /**
     * Load an HDR environment map from URL
     */
    loadHDREnvironment(url: string): Promise<Texture> {
        return new Promise((resolve, reject) => {
            if (!this.pmremGenerator) {
                this.pmremGenerator = new PMREMGenerator(this.renderer);
                this.pmremGenerator.compileEquirectangularShader();
            }

            const loader = new RGBELoader();
            loader.load(
                url,
                (texture) => {
                    texture.mapping = THREE.EquirectangularReflectionMapping;

                    // Dispose old env map
                    if (this.currentEnvMap) this.currentEnvMap.dispose();
                    if (this.currentEnvTexture) this.currentEnvTexture.dispose();

                    this.currentEnvTexture = texture;
                    this.currentEnvMap = this.pmremGenerator!.fromEquirectangular(texture).texture;

                    // Apply as environment lighting (IBL)
                    this.scene!.environment = this.currentEnvMap;

                    // If env-as-background is enabled, also set as background
                    if (this.envAsBackground) {
                        this.scene!.background = this.currentEnvTexture;
                    }

                    log.info('HDR environment loaded:', url);
                    resolve(this.currentEnvMap);
                },
                undefined,
                (error) => {
                    log.error('Failed to load HDR environment:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Load HDR environment from a File object
     */
    loadHDREnvironmentFromFile(file: File): Promise<Texture> {
        const url = URL.createObjectURL(file);
        return this.loadHDREnvironment(url).finally(() => {
            URL.revokeObjectURL(url);
        });
    }

    /**
     * Clear the current HDR environment
     */
    clearEnvironment(): void {
        this.scene!.environment = null;
        if (this.envAsBackground) {
            this.scene!.background = this.savedBackgroundColor || new Color(COLORS.SCENE_BACKGROUND);
            this.envAsBackground = false;
        }
        if (this.currentEnvMap) {
            this.currentEnvMap.dispose();
            this.currentEnvMap = null;
        }
        if (this.currentEnvTexture) {
            this.currentEnvTexture.dispose();
            this.currentEnvTexture = null;
        }
        log.info('Environment cleared');
    }

    /**
     * Toggle environment as scene background
     */
    setEnvironmentAsBackground(show: boolean): void {
        this.envAsBackground = show;
        if (show && this.currentEnvTexture) {
            if (this.scene!.background instanceof Color) {
                this.savedBackgroundColor = this.scene!.background.clone();
            }
            this.scene!.background = this.currentEnvTexture;
            this.clearBackgroundImage();
        } else if (!show) {
            if (this.backgroundImageTexture) {
                this.scene!.background = this.backgroundImageTexture;
            } else {
                this.scene!.background = this.savedBackgroundColor || new Color(COLORS.SCENE_BACKGROUND);
            }
        }
    }

    // =========================================================================
    // SHADOWS
    // =========================================================================

    /**
     * Enable or disable shadow rendering
     */
    enableShadows(enabled: boolean): void {
        // WebGPU renderer has a bug with shadow map textures ("Texture already initialized")
        // so skip shadow operations when using WebGPU
        if (this.rendererType === 'webgpu') {
            log.info('Shadows not supported on WebGPU renderer, skipping');
            return;
        }
        this.renderer!.shadowMap.enabled = enabled;
        this.rendererRight!.shadowMap.enabled = enabled;
        this.directionalLight1!.castShadow = enabled;

        // Enable castShadow on all meshes in modelGroup
        if (this.modelGroup) {
            this.modelGroup.traverse((child) => {
                if ((child as Mesh).isMesh) {
                    (child as Mesh).castShadow = enabled;
                    (child as Mesh).receiveShadow = enabled;
                }
            });
        }

        // Toggle shadow catcher plane
        if (enabled) {
            this.createShadowCatcher();
        } else {
            this.removeShadowCatcher();
        }

        // Force shadow map rebuild
        this.renderer!.shadowMap.needsUpdate = true;
        this.rendererRight!.shadowMap.needsUpdate = true;

        log.info('Shadows', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Apply shadow properties to all meshes in an object.
     * Call after loading new models when shadows are enabled.
     */
    applyShadowProperties(object: Object3D): void {
        const shadowsEnabled = this.renderer!.shadowMap.enabled;
        object.traverse((child) => {
            if ((child as Mesh).isMesh) {
                (child as Mesh).castShadow = shadowsEnabled;
                (child as Mesh).receiveShadow = shadowsEnabled;
            }
        });
    }

    /**
     * Create a shadow catcher ground plane
     */
    createShadowCatcher(): void {
        if (this.shadowCatcherPlane) return;

        const geometry = new PlaneGeometry(
            SHADOWS.GROUND_PLANE_SIZE,
            SHADOWS.GROUND_PLANE_SIZE
        );
        const material = new ShadowMaterial({
            opacity: 0.3,
            color: 0x000000,
            depthWrite: false        // Don't write to depth buffer - prevents occluding splats
        });

        this.shadowCatcherPlane = new Mesh(geometry, material);
        this.shadowCatcherPlane.rotation.x = -Math.PI / 2;
        this.shadowCatcherPlane.position.y = SHADOWS.GROUND_PLANE_Y;
        this.shadowCatcherPlane.receiveShadow = true;
        this.shadowCatcherPlane.renderOrder = -1;  // Render before other objects
        this.shadowCatcherPlane.name = 'shadowCatcher';

        // Exclude from raycasting so annotations/alignment pass through
        this.shadowCatcherPlane.raycast = () => {};

        this.scene!.add(this.shadowCatcherPlane);
        log.info('Shadow catcher plane created');
    }

    /**
     * Remove the shadow catcher ground plane
     */
    removeShadowCatcher(): void {
        if (this.shadowCatcherPlane) {
            this.scene!.remove(this.shadowCatcherPlane);
            this.shadowCatcherPlane.geometry.dispose();
            this.shadowCatcherPlane.material.dispose();
            this.shadowCatcherPlane = null;
            log.info('Shadow catcher plane removed');
        }
    }

    /**
     * Set shadow catcher opacity
     */
    setShadowCatcherOpacity(opacity: number): void {
        if (this.shadowCatcherPlane && this.shadowCatcherPlane.material) {
            this.shadowCatcherPlane.material.opacity = opacity;
        }
    }

    // =========================================================================
    // BACKGROUND IMAGE
    // =========================================================================

    /**
     * Load a background image from URL
     */
    loadBackgroundImage(url: string): Promise<Texture> {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    if (this.backgroundImageTexture) {
                        this.backgroundImageTexture.dispose();
                    }
                    this.backgroundImageTexture = texture;
                    this.scene!.background = texture;
                    this.envAsBackground = false;
                    log.info('Background image loaded');
                    resolve(texture);
                },
                undefined,
                (error) => {
                    log.error('Failed to load background image:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Load a background image from a File object
     */
    loadBackgroundImageFromFile(file: File): Promise<Texture> {
        const url = URL.createObjectURL(file);
        return this.loadBackgroundImage(url).then((texture) => {
            URL.revokeObjectURL(url);
            return texture;
        }).catch((error) => {
            URL.revokeObjectURL(url);
            throw error;
        });
    }

    /**
     * Clear the background image and revert to solid color
     */
    clearBackgroundImage(): void {
        if (this.backgroundImageTexture) {
            this.backgroundImageTexture.dispose();
            this.backgroundImageTexture = null;
        }
    }

    /**
     * Handle window resize
     */
    onWindowResize(displayMode: string, container: HTMLElement): void {
        if (displayMode === 'split') {
            const halfWidth = container.clientWidth / 2;
            this.camera!.aspect = halfWidth / container.clientHeight;
            this.camera!.updateProjectionMatrix();
            this.renderer!.setSize(halfWidth, container.clientHeight);
            this.rendererRight!.setSize(halfWidth, container.clientHeight);
        } else {
            this.camera!.aspect = container.clientWidth / container.clientHeight;
            this.camera!.updateProjectionMatrix();
            this.renderer!.setSize(container.clientWidth, container.clientHeight);
        }
    }

    /**
     * Update light intensity
     */
    setLightIntensity(lightType: string, intensity: number): void {
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
     */
    setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
        this.transformControls!.setMode(mode);
    }

    /**
     * Attach transform controls to an object
     */
    attachTransformControls(object: Object3D | null): void {
        try {
            this.transformControls!.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }

        if (object) {
            try {
                this.transformControls!.attach(object);
            } catch (attachError) {
                log.error('Error attaching transform controls:', attachError);
            }
        }
    }

    /**
     * Detach transform controls
     */
    detachTransformControls(): void {
        try {
            this.transformControls!.detach();
        } catch (e) {
            log.warn('Error detaching transform controls:', e);
        }
    }

    /**
     * Update FPS counter
     */
    updateFPS(fpsElement: HTMLElement | null): void {
        this.frameCount++;
        const currentTime = performance.now();
        if (currentTime - this.lastFpsTime >= 1000) {
            this.lastFPS = this.frameCount;
            if (fpsElement) {
                fpsElement.textContent = this.frameCount.toString();
            }
            this.frameCount = 0;
            this.lastFpsTime = currentTime;
        }
    }

    /**
     * Render a single frame
     */
    render(
        displayMode: string,
        splatMesh: Object3D | null,
        modelGroup: Group | null,
        pointcloudGroup: Group | null,
        stlGroup: Group | null
    ): void {
        // Skip rendering if WebGPU backend hasn't finished initializing
        if (this.rendererType === 'webgpu' && !(this.renderer as any)?._initialized) {
            return;
        }
        if (displayMode === 'split') {
            // Split view - render splat on left, model + pointcloud + stl on right
            const splatVisible = splatMesh ? splatMesh.visible : false;
            const modelVisible = modelGroup ? modelGroup.visible : false;
            const pcVisible = pointcloudGroup ? pointcloudGroup.visible : false;
            const stlVisible = stlGroup ? stlGroup.visible : false;

            // Left view - splat only
            if (splatMesh) splatMesh.visible = true;
            if (modelGroup) modelGroup.visible = false;
            if (pointcloudGroup) pointcloudGroup.visible = false;
            if (stlGroup) stlGroup.visible = false;
            this.renderer!.render(this.scene!, this.camera!);

            // Right view - model + pointcloud + stl
            if (splatMesh) splatMesh.visible = false;
            if (modelGroup) modelGroup.visible = true;
            if (pointcloudGroup) pointcloudGroup.visible = true;
            if (stlGroup) stlGroup.visible = true;
            this.rendererRight!.render(this.scene!, this.camera!);

            // Restore visibility
            if (splatMesh) splatMesh.visible = splatVisible;
            if (modelGroup) modelGroup.visible = modelVisible;
            if (pointcloudGroup) pointcloudGroup.visible = pcVisible;
            if (stlGroup) stlGroup.visible = stlVisible;
        } else {
            // Normal view
            this.renderer!.render(this.scene!, this.camera!);
        }
    }

    /**
     * Enable or disable material-level clipping on both renderers.
     * Must be true for material.clippingPlanes to take effect (Three.js requirement).
     */
    setLocalClippingEnabled(enabled: boolean): void {
        if (this.renderer && 'localClippingEnabled' in this.renderer) {
            this.renderer.localClippingEnabled = enabled;
        }
        if (this.rendererRight && 'localClippingEnabled' in this.rendererRight) {
            this.rendererRight.localClippingEnabled = enabled;
        }
    }

    /**
     * Add an object to the scene
     */
    addToScene(object: Object3D): void {
        this.scene!.add(object);
    }

    /**
     * Remove an object from the scene
     */
    removeFromScene(object: Object3D): void {
        this.scene!.remove(object);
    }

    /**
     * Dispose of scene resources
     */
    dispose(): void {
        // Clean up environment
        if (this.currentEnvMap) {
            this.currentEnvMap.dispose();
            this.currentEnvMap = null;
        }
        if (this.currentEnvTexture) {
            this.currentEnvTexture.dispose();
            this.currentEnvTexture = null;
        }
        if (this.pmremGenerator) {
            this.pmremGenerator.dispose();
            this.pmremGenerator = null;
        }
        if (this.backgroundImageTexture) {
            this.backgroundImageTexture.dispose();
            this.backgroundImageTexture = null;
        }
        this.removeShadowCatcher();

        if (this.gridHelper) {
            this.scene!.remove(this.gridHelper);
            this.gridHelper.dispose();
            this.gridHelper = null;
        }

        if (this.transformControls) {
            this.scene!.remove(this.transformControls.getHelper());
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
 */
export async function createSceneManager(canvas: HTMLCanvasElement, canvasRight: HTMLCanvasElement): Promise<SceneManager | null> {
    const manager = new SceneManager();
    const success = await manager.init(canvas, canvasRight);
    return success ? manager : null;
}

export default SceneManager;
