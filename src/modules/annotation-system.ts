// Annotation System Module
// Handles 3D annotation placement, rendering, and navigation
// Based on the U3DP annotation viewer pattern

import * as THREE from 'three';
import type { Annotation } from '@/types.js';

// TODO: type when @types/three is installed
type Vector3 = any;
type Scene = any;
type Camera = any;
type WebGLRenderer = any;
type Raycaster = any;
type Vector2 = any;
type Group = any;
type OrbitControls = any;

interface MarkerObject {
    element: HTMLDivElement;
    annotation: Annotation;
    position: Vector3;
}

interface DragState {
    marker: MarkerObject;
    originalPos: Vector3;
}

interface CameraState {
    camera_target: { x: number; y: number; z: number };
    camera_position: { x: number; y: number; z: number };
}

/**
 * AnnotationSystem class - manages annotations in 3D space
 */
export class AnnotationSystem {
    // TODO: type when @types/three is installed
    scene: Scene;
    camera: Camera;
    renderer: WebGLRenderer;
    controls: OrbitControls;

    annotations: Annotation[];
    markers: MarkerObject[];
    markerGroup: Group;

    // State
    placementMode: boolean;
    pendingPosition: { x: number; y: number; z: number } | null;
    selectedAnnotation: Annotation | null;
    annotationCount: number;

    // Raycaster for click detection
    raycaster: Raycaster;
    mouse: Vector2;

    // DOM elements for 2D markers
    markerContainer: HTMLDivElement | null;
    pendingMarkerEl: HTMLDivElement | null;

    // Callbacks
    onAnnotationCreated: ((position: { x: number; y: number; z: number }, cameraState: CameraState) => void) | null;
    onAnnotationSelected: ((annotation: Annotation) => void) | null;
    onAnnotationUpdated: ((annotation: Annotation) => void) | null;
    onPlacementModeChanged: ((isEnabled: boolean) => void) | null;

    // Reusable vectors for occlusion checks
    _surfaceNormal: Vector3;
    _viewDir: Vector3;

    // Drag state
    _dragging: DragState | null;

    // Bound methods
    _onClick: (event: MouseEvent) => void;
    _onDragMove: (event: MouseEvent) => void;
    _onDragEnd: (event: MouseEvent) => void;

    constructor(scene: Scene, camera: Camera, renderer: WebGLRenderer, controls: OrbitControls) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;

        this.annotations = [];
        this.markers = [];
        this.markerGroup = new THREE.Group();
        this.markerGroup.name = 'annotationMarkers';
        scene.add(this.markerGroup);

        // State
        this.placementMode = false;
        this.pendingPosition = null;
        this.selectedAnnotation = null;
        this.annotationCount = 0;

        // Raycaster for click detection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // DOM elements for 2D markers
        this.markerContainer = null;
        this.pendingMarkerEl = null;

        // Callbacks
        this.onAnnotationCreated = null;
        this.onAnnotationSelected = null;
        this.onAnnotationUpdated = null;
        this.onPlacementModeChanged = null;

        // Reusable vectors for occlusion checks
        this._surfaceNormal = new THREE.Vector3();
        this._viewDir = new THREE.Vector3();

        // Drag state
        this._dragging = null;

        // Bind methods
        this._onClick = this._onClickHandler.bind(this);
        this._onDragMove = this._onDragMoveHandler.bind(this);
        this._onDragEnd = this._onDragEndHandler.bind(this);

        this._createMarkerContainer();
    }

    /**
     * Create the DOM container for 2D annotation markers
     */
    _createMarkerContainer(): void {
        this.markerContainer = document.getElementById('annotation-markers') as HTMLDivElement | null;
        if (!this.markerContainer) {
            this.markerContainer = document.createElement('div');
            this.markerContainer.id = 'annotation-markers';
            document.body.appendChild(this.markerContainer);
        }
    }

    /**
     * Enable annotation placement mode
     */
    enablePlacementMode(): void {
        this.placementMode = true;
        this.renderer.domElement.style.cursor = 'crosshair';
        this.renderer.domElement.addEventListener('click', this._onClick);

        if (this.onPlacementModeChanged) {
            this.onPlacementModeChanged(true);
        }
    }

    /**
     * Disable annotation placement mode
     */
    disablePlacementMode(): void {
        this.placementMode = false;
        this.renderer.domElement.style.cursor = 'default';
        this.renderer.domElement.removeEventListener('click', this._onClick);
        this._removePendingMarker();
        this.pendingPosition = null;

        if (this.onPlacementModeChanged) {
            this.onPlacementModeChanged(false);
        }
    }

    /**
     * Toggle placement mode
     */
    togglePlacementMode(): void {
        if (this.placementMode) {
            this.disablePlacementMode();
        } else {
            this.enablePlacementMode();
        }
    }

    /**
     * Handle click events for annotation placement
     */
    _onClickHandler(event: MouseEvent): void {
        if (!this.placementMode) return;

        // Don't process if clicking on UI elements
        if (event.target !== this.renderer.domElement) return;

        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Raycast against scene objects
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        // Filter out markers and helpers
        const validIntersects = intersects.filter((hit: any) => {
            let obj = hit.object;
            while (obj) {
                if (obj.name === 'annotationMarkers' ||
                    obj.type === 'GridHelper' ||
                    obj.type === 'AxesHelper') {
                    return false;
                }
                obj = obj.parent;
            }
            return true;
        });

        if (validIntersects.length > 0) {
            const point = validIntersects[0].point;
            this.pendingPosition = {
                x: parseFloat(point.x.toFixed(4)),
                y: parseFloat(point.y.toFixed(4)),
                z: parseFloat(point.z.toFixed(4))
            };

            // Show pending marker
            this._showPendingMarker(event.clientX, event.clientY);

            // Trigger callback to show annotation panel
            if (this.onAnnotationCreated) {
                this.onAnnotationCreated(this.pendingPosition, this._getCurrentCameraState());
            }
        }
    }

    /**
     * Get current camera position and target
     */
    _getCurrentCameraState(): CameraState {
        return {
            camera_target: {
                x: parseFloat(this.controls.target.x.toFixed(4)),
                y: parseFloat(this.controls.target.y.toFixed(4)),
                z: parseFloat(this.controls.target.z.toFixed(4))
            },
            camera_position: {
                x: parseFloat(this.camera.position.x.toFixed(4)),
                y: parseFloat(this.camera.position.y.toFixed(4)),
                z: parseFloat(this.camera.position.z.toFixed(4))
            }
        };
    }

    /**
     * Show pending marker at screen position
     */
    _showPendingMarker(screenX: number, screenY: number): void {
        this._removePendingMarker();

        this.pendingMarkerEl = document.createElement('div');
        this.pendingMarkerEl.className = 'annotation-marker pending';
        this.pendingMarkerEl.textContent = '?';
        this.pendingMarkerEl.style.left = screenX + 'px';
        this.pendingMarkerEl.style.top = screenY + 'px';
        this.markerContainer?.appendChild(this.pendingMarkerEl);
    }

    /**
     * Remove pending marker
     */
    _removePendingMarker(): void {
        if (this.pendingMarkerEl) {
            this.pendingMarkerEl.remove();
            this.pendingMarkerEl = null;
        }
    }

    /**
     * Confirm pending annotation with title and body
     */
    confirmAnnotation(id: string, title: string, body: string): Annotation | null {
        if (!this.pendingPosition) return null;

        const cameraState = this._getCurrentCameraState();

        const annotation: Annotation = {
            id: id || `anno_${++this.annotationCount}`,
            title: title || 'Untitled',
            body: body || '',
            position: { ...this.pendingPosition },
            camera_target: cameraState.camera_target,
            camera_position: cameraState.camera_position
        };

        this.annotations.push(annotation);
        this._createMarker(annotation, this.annotations.length);

        // Remove pending marker
        this._removePendingMarker();
        this.pendingPosition = null;

        return annotation;
    }

    /**
     * Cancel pending annotation
     */
    cancelAnnotation(): void {
        this._removePendingMarker();
        this.pendingPosition = null;
    }

    /**
     * Create a marker for an annotation
     */
    _createMarker(annotation: Annotation, number: number): void {
        const markerEl = document.createElement('div');
        markerEl.className = 'annotation-marker';
        markerEl.textContent = number.toString();
        markerEl.dataset.annotationId = annotation.id;
        markerEl.setAttribute('role', 'button');
        markerEl.setAttribute('tabindex', '0');
        markerEl.setAttribute('aria-label', `Annotation ${number}: ${annotation.title || 'untitled'}`);
        markerEl.addEventListener('click', () => this.selectAnnotation(annotation.id));
        markerEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.selectAnnotation(annotation.id);
            }
        });

        this.markerContainer?.appendChild(markerEl);

        const markerObj: MarkerObject = {
            element: markerEl,
            annotation: annotation,
            position: new THREE.Vector3(
                annotation.position.x,
                annotation.position.y,
                annotation.position.z
            )
        };

        // Shift+mousedown starts drag to reposition
        markerEl.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.shiftKey) this._onMarkerShiftDown(e, markerObj);
        });

        this.markers.push(markerObj);
    }

    /**
     * Start dragging a marker to reposition it (shift+mousedown)
     */
    _onMarkerShiftDown(event: MouseEvent, marker: MarkerObject): void {
        event.preventDefault();
        event.stopPropagation();

        this._dragging = {
            marker,
            originalPos: marker.position.clone()
        };

        // Disable orbit controls during drag
        if (this.controls) this.controls.enabled = false;

        marker.element.classList.add('dragging');

        document.addEventListener('mousemove', this._onDragMove);
        document.addEventListener('mouseup', this._onDragEnd);
    }

    /**
     * Handle drag movement — raycast to find new surface position
     */
    _onDragMoveHandler(event: MouseEvent): void {
        if (!this._dragging) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        // Same filter as _onClick — exclude markers, grid, axes
        const validHit = intersects.find((hit: any) => {
            let obj = hit.object;
            while (obj) {
                if (obj.name === 'annotationMarkers' ||
                    obj.type === 'GridHelper' ||
                    obj.type === 'AxesHelper') {
                    return false;
                }
                obj = obj.parent;
            }
            return true;
        });

        if (validHit) {
            const point = validHit.point;
            const marker = this._dragging.marker;

            // Update 3D position
            marker.position.set(point.x, point.y, point.z);
            marker.annotation.position = {
                x: parseFloat(point.x.toFixed(4)),
                y: parseFloat(point.y.toFixed(4)),
                z: parseFloat(point.z.toFixed(4))
            };
        }
    }

    /**
     * End drag — finalize position and re-enable controls
     */
    _onDragEndHandler(_event: MouseEvent): void {
        if (!this._dragging) return;

        const marker = this._dragging.marker;

        document.removeEventListener('mousemove', this._onDragMove);
        document.removeEventListener('mouseup', this._onDragEnd);

        // Re-enable orbit controls
        if (this.controls) this.controls.enabled = true;

        marker.element.classList.remove('dragging');

        // Update camera reference for surface-normal occlusion
        const cameraState = this._getCurrentCameraState();
        marker.annotation.camera_position = cameraState.camera_position;
        marker.annotation.camera_target = {
            x: marker.annotation.position.x,
            y: marker.annotation.position.y,
            z: marker.annotation.position.z
        };

        // Notify that annotation was updated
        if (this.onAnnotationUpdated) {
            this.onAnnotationUpdated(marker.annotation);
        }

        this._dragging = null;
    }

    /**
     * Update all marker screen positions
     * Call this in the animation loop
     */
    updateMarkerPositions(): void {
        const rect = this.renderer.domElement.getBoundingClientRect();

        this.markers.forEach(marker => {
            const screenPos = marker.position.clone().project(this.camera);
            const x = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
            const y = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top;

            // Check if behind camera
            if (screenPos.z > 1) {
                marker.element.style.display = 'none';
            } else {
                marker.element.style.display = 'flex';
                marker.element.style.left = x + 'px';
                marker.element.style.top = y + 'px';

                // Surface-normal occlusion using stored annotation camera position.
                // The direction from annotation point toward the camera that placed it
                // approximates the surface normal at that point.
                const anno = marker.annotation;
                if (anno.camera_position) {
                    this._surfaceNormal.set(
                        anno.camera_position.x - anno.position.x,
                        anno.camera_position.y - anno.position.y,
                        anno.camera_position.z - anno.position.z
                    ).normalize();

                    this._viewDir.set(
                        this.camera.position.x - anno.position.x,
                        this.camera.position.y - anno.position.y,
                        this.camera.position.z - anno.position.z
                    ).normalize();

                    // Dot < 0 means camera is on the opposite side of the surface
                    const dot = this._surfaceNormal.dot(this._viewDir);
                    marker.element.classList.toggle('occluded', dot < 0.05);
                }
            }
        });
    }

    /**
     * Select an annotation
     */
    selectAnnotation(id: string): void {
        const annotation = this.annotations.find(a => a.id === id);
        if (!annotation) return;

        this.selectedAnnotation = annotation;

        // Update marker styling
        this.markers.forEach(m => {
            m.element.classList.toggle('selected', m.annotation.id === id);
        });

        if (this.onAnnotationSelected) {
            this.onAnnotationSelected(annotation);
        }
    }

    /**
     * Navigate camera to annotation viewpoint
     */
    goToAnnotation(id: string, duration: number = 1000): void {
        const annotation = this.annotations.find(a => a.id === id);
        if (!annotation) return;

        this.selectAnnotation(id);

        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();

        const endPos = new THREE.Vector3(
            annotation.camera_position.x,
            annotation.camera_position.y,
            annotation.camera_position.z
        );
        const endTarget = new THREE.Vector3(
            annotation.camera_target.x,
            annotation.camera_target.y,
            annotation.camera_target.z
        );

        const startTime = performance.now();

        const animate = (): void => {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / duration, 1);

            // Ease in-out
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;

            this.camera.position.lerpVectors(startPos, endPos, eased);
            this.controls.target.lerpVectors(startTarget, endTarget, eased);
            this.controls.update();

            if (t < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    }

    /**
     * Update an existing annotation
     */
    updateAnnotation(id: string, updates: Partial<Annotation>): Annotation | null {
        const annotation = this.annotations.find(a => a.id === id);
        if (!annotation) return null;

        Object.assign(annotation, updates);

        // Update marker position if changed
        if (updates.position) {
            const marker = this.markers.find(m => m.annotation.id === id);
            if (marker) {
                marker.position.set(
                    updates.position.x,
                    updates.position.y,
                    updates.position.z
                );
            }
        }

        return annotation;
    }

    /**
     * Update annotation camera from current view
     */
    updateAnnotationCamera(id: string): Annotation | null {
        const cameraState = this._getCurrentCameraState();
        return this.updateAnnotation(id, cameraState);
    }

    /**
     * Delete an annotation
     */
    deleteAnnotation(id: string): boolean {
        const index = this.annotations.findIndex(a => a.id === id);
        if (index === -1) return false;

        this.annotations.splice(index, 1);

        // Remove marker
        const markerIndex = this.markers.findIndex(m => m.annotation.id === id);
        if (markerIndex !== -1) {
            this.markers[markerIndex].element.remove();
            this.markers.splice(markerIndex, 1);
        }

        // Renumber remaining markers
        this.markers.forEach((m, i) => {
            m.element.textContent = (i + 1).toString();
        });

        if (this.selectedAnnotation?.id === id) {
            this.selectedAnnotation = null;
        }

        return true;
    }

    /**
     * Clear all annotations
     */
    clearAnnotations(): void {
        this.markers.forEach(m => m.element.remove());
        this.markers = [];
        this.annotations = [];
        this.selectedAnnotation = null;
        this.annotationCount = 0;
    }

    /**
     * Get all annotations
     */
    getAnnotations(): Annotation[] {
        return [...this.annotations];
    }

    /**
     * Set annotations from array (e.g., loaded from archive)
     */
    setAnnotations(annotations: Annotation[]): void {
        this.clearAnnotations();

        annotations.forEach((anno, index) => {
            this.annotations.push(anno);
            this._createMarker(anno, index + 1);
            this.annotationCount = Math.max(this.annotationCount,
                parseInt(anno.id.replace(/\D/g, '')) || index + 1);
        });
    }

    /**
     * Export annotations to JSON
     */
    toJSON(): Annotation[] {
        return this.annotations.map(a => ({
            id: a.id,
            title: a.title,
            body: a.body,
            position: { ...a.position },
            camera_target: { ...a.camera_target },
            camera_position: { ...a.camera_position }
        }));
    }

    /**
     * Import annotations from JSON
     */
    fromJSON(data: Annotation[]): void {
        if (Array.isArray(data)) {
            this.setAnnotations(data);
        }
    }

    /**
     * Show/hide all markers
     */
    setMarkersVisible(visible: boolean): void {
        if (this.markerContainer) {
            this.markerContainer.style.display = visible ? 'block' : 'none';
        }
    }

    /**
     * Check if there are any annotations
     */
    hasAnnotations(): boolean {
        return this.annotations.length > 0;
    }

    /**
     * Get annotation count
     */
    getCount(): number {
        return this.annotations.length;
    }

    /**
     * Update the renderer reference (e.g., after a WebGPU/WebGL switch).
     * Unbinds event listeners from the old canvas and rebinds to the new one.
     */
    updateRenderer(newRenderer: any): void {
        // Remove listeners from old canvas
        if (this.renderer && this.renderer.domElement) {
            this.renderer.domElement.removeEventListener('click', this._onClick);
            this.renderer.domElement.style.cursor = '';
        }

        this.renderer = newRenderer;

        // Rebind if placement mode is active
        if (this.placementMode && this.renderer && this.renderer.domElement) {
            this.renderer.domElement.addEventListener('click', this._onClick);
            this.renderer.domElement.style.cursor = 'crosshair';
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.disablePlacementMode();
        this.clearAnnotations();
        if (this.markerContainer) {
            this.markerContainer.innerHTML = '';
        }
        this.scene.remove(this.markerGroup);
    }
}

export default AnnotationSystem;
