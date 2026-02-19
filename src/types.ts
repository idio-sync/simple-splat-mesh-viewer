// ===== Union Types =====

export type DisplayMode = 'splat' | 'model' | 'pointcloud' | 'both' | 'split' | 'stl';
export type SelectedObject = 'splat' | 'model' | 'both' | 'none';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type QualityTier = 'sd' | 'hd';
export type AssetStateValue = 'unloaded' | 'loading' | 'loaded' | 'error';

// ===== Main State =====

export interface AppState {
    displayMode: DisplayMode;
    selectedObject: SelectedObject;
    transformMode: TransformMode;
    splatLoaded: boolean;
    modelLoaded: boolean;
    pointcloudLoaded: boolean;
    stlLoaded: boolean;
    modelOpacity: number;
    modelWireframe: boolean;
    modelMatcap: boolean;
    matcapStyle: string;
    modelNormals: boolean;
    modelRoughness: boolean;
    modelMetalness: boolean;
    modelSpecularF0: boolean;
    pointcloudPointSize: number;
    pointcloudOpacity: number;
    controlsVisible: boolean;
    currentSplatUrl: string | null;
    currentModelUrl: string | null;
    currentPointcloudUrl: string | null;
    // Archive state
    archiveLoaded: boolean;
    archiveManifest: any | null;         // Manifest shape varies per version
    archiveFileName: string | null;
    currentArchiveUrl: string | null;
    archiveLoader: any | null;           // ArchiveLoader instance (JS module, untyped)
    assetStates: Record<string, string>;  // Values are ASSET_STATE constants (untyped JS)
    viewingProxy: boolean;
    qualityTier: string;                   // 'sd' | 'hd' — widened because constants.js is untyped
    qualityResolved: string;               // 'sd' | 'hd' — widened because constants.js is untyped
    imageAssets: Map<string, any>;         // Map of asset key → blob URL or metadata
    screenshots: Array<{ id: string; blob: Blob; dataUrl: string; timestamp: number }>;
    manualPreviewBlob: Blob | null;
    // Detected asset format extensions (set during file load)
    meshFormat: string | null;
    pointcloudFormat: string | null;
    splatFormat: string | null;
    meshVertexCount?: number;              // Dynamically set by file-handlers.js after mesh load
    meshTextureInfo?: import('./modules/utilities.js').TextureInfo;  // Dynamically set after mesh load
    // Allow additional dynamic properties set by JS modules
    [key: string]: any;
}

// ===== Scene References =====

export interface SceneRefs {
    readonly scene: any;              // THREE.Scene
    readonly camera: any;             // THREE.PerspectiveCamera
    readonly renderer: any;           // THREE.WebGLRenderer
    readonly controls: any;           // OrbitControls
    readonly transformControls: any;  // TransformControls
    readonly splatMesh: any;          // SplatMesh | null
    readonly modelGroup: any;         // THREE.Group
    readonly pointcloudGroup: any;    // THREE.Group
    readonly stlGroup: any;           // THREE.Group
    readonly flyControls: any;        // FlyControls | null
    readonly annotationSystem: any;   // AnnotationSystem | null
    readonly archiveCreator: any;     // ArchiveCreator | null
    readonly landmarkAlignment: any;  // LandmarkAlignment | null
    readonly ambientLight: any;       // THREE.AmbientLight
    readonly hemisphereLight: any;    // THREE.HemisphereLight
    readonly directionalLight1: any;  // THREE.DirectionalLight
    readonly directionalLight2: any;  // THREE.DirectionalLight
}

// ===== Common UI Callback Shapes =====

export interface UICallbacks {
    showLoading: (msg: string, withProgress?: boolean) => void;
    hideLoading: () => void;
    updateProgress?: (percent: number, stage?: string) => void;
}

// ===== 3D Data Types =====

/** 3D position/rotation/scale transform, used in alignment data and archive manifests. */
export interface Transform {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: number;
}

/** A 3D annotation placed on a surface via raycasting. */
export interface Annotation {
    id: string;
    title: string;
    body: string;
    position: { x: number; y: number; z: number };
    camera_target: { x: number; y: number; z: number };
    camera_position: { x: number; y: number; z: number };
}

// ===== Asset Store =====

export interface AssetStore {
    splatBlob: Blob | null;
    meshBlob: Blob | null;
    proxyMeshBlob: Blob | null;
    proxySplatBlob: Blob | null;
    pointcloudBlob: Blob | null;
    sourceFiles: Array<{ name: string; blob: Blob }>;
}

// ===== Module Dependencies =====

export interface ExportDeps {
    sceneRefs: Pick<SceneRefs, 'renderer' | 'scene' | 'camera' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'annotationSystem' | 'archiveCreator'>;
    state: AppState;
    tauriBridge: any | null;
    ui: {
        showLoading: (msg: string, withProgress?: boolean) => void;
        hideLoading: () => void;
        updateProgress: (percent: number, stage?: string) => void;
        hideExportPanel: () => void;
        showExportPanelHandler: () => void;
        showMetadataPanel: () => void;
    };
    metadata: {
        collectMetadata: () => any;
        prefillMetadataFromArchive: (manifest: any) => void;
        populateMetadataDisplay: () => void;
        loadAnnotationsFromArchive: (annotations: any[]) => void;
    };
}

export interface ArchivePipelineDeps {
    sceneRefs: Pick<SceneRefs, 'scene' | 'camera' | 'renderer' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup'>;
    state: AppState;
    sceneManager: any;
    setSplatMesh: (mesh: any) => void;
    createFileHandlerDeps: () => any;
    ui: {
        showLoading: (msg: string, withProgress?: boolean) => void;
        hideLoading: () => void;
        updateProgress: (percent: number, stage?: string | null) => void;
        showInlineLoading: (type: string) => void;
        hideInlineLoading: (type: string) => void;
        updateVisibility: () => void;
        updateTransformInputs: () => void;
        updateModelOpacity: () => void;
        updateModelWireframe: () => void;
    };
    alignment: {
        applyAlignmentData: (data: any) => void;
        storeLastPositions: () => void;
    };
    annotations: {
        loadAnnotationsFromArchive: (annotations: any[]) => void;
    };
    metadata: {
        prefillMetadataFromArchive: (manifest: any) => void;
        clearArchiveMetadataHandler: () => void;
    };
    sourceFiles: {
        updateSourceFilesUI: () => void;
    };
}

export interface EventWiringDeps {
    sceneRefs: Pick<SceneRefs, 'scene' | 'camera' | 'controls' | 'splatMesh' | 'modelGroup' | 'pointcloudGroup' | 'flyControls' | 'ambientLight' | 'hemisphereLight' | 'directionalLight1' | 'directionalLight2'>;
    state: AppState;
    sceneManager: any;
    files: {
        handleSplatFile: (e: Event) => void;
        handleModelFile: (e: Event) => void;
        handleArchiveFile: (e: Event) => void;
        handlePointcloudFile: (e: Event) => void;
        handleProxyMeshFile: (e: Event) => void;
        handleProxySplatFile: (e: Event) => void;
        handleSTLFile: (e: Event) => void;
        handleSourceFilesInput: (e: Event) => void;
        handleLoadSplatFromUrlPrompt: () => void;
        handleLoadModelFromUrlPrompt: () => void;
        handleLoadPointcloudFromUrlPrompt: () => void;
        handleLoadArchiveFromUrlPrompt: () => void;
        handleLoadSTLFromUrlPrompt: () => void;
        handleLoadFullResMesh: () => void;
        switchQualityTier: (tier: string) => void;
    };
    display: {
        setDisplayMode: (mode: string) => void;
        updateModelOpacity: () => void;
        updateModelWireframe: () => void;
        updateModelMatcap: () => void;
        updateModelNormals: () => void;
        updateModelRoughnessView: () => void;
        updateModelMetalnessView: () => void;
        updateModelSpecularF0View: () => void;
        toggleGridlines: (show: boolean) => void;
        setBackgroundColor: (hex: string) => void;
    };
    camera: {
        resetCamera: () => void;
        fitToView: () => void;
        toggleFlyMode: () => void;
    };
    alignment: {
        resetAlignment: () => void;
        toggleAlignment: () => void;
    };
    annotations: {
        toggleAnnotationMode: () => void;
        saveAnnotation: () => void;
        cancelAnnotation: () => void;
        updateSelectedAnnotationCamera: () => void;
        deleteSelectedAnnotation: () => void;
        dismissPopup: () => void;
    };
    export: {
        showExportPanel: () => void;
        downloadArchive: () => void;
        downloadGenericViewer: () => void;
    };
    screenshots: {
        captureScreenshotToList: () => void;
        showViewfinder: () => void;
        captureManualPreview: () => void;
        hideViewfinder: () => void;
    };
    metadata: {
        hideMetadataPanel: () => void;
        toggleMetadataDisplay: () => void;
        setupMetadataSidebar: () => void;
    };
    share: {
        copyShareLink: () => void;
    };
    transform: {
        setSelectedObject: (selection: SelectedObject) => void;
        setTransformMode: (mode: TransformMode) => void;
        resetTransform: () => void;
    };
    tauri: {
        wireNativeDialogsIfAvailable: () => void;
    };
}
