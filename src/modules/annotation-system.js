// Annotation System Module
// Handles 3D annotation placement, rendering, and navigation
// Based on the U3DP annotation viewer pattern

import * as THREE from 'three';

/**
 * Annotation data structure
 * @typedef {Object} Annotation
 * @property {string} id - Unique identifier
 * @property {string} title - Display title
 * @property {string} body - Description text
 * @property {{x: number, y: number, z: number}} position - 3D world position
 * @property {{x: number, y: number, z: number}} camera_target - Where camera looks
 * @property {{x: number, y: number, z: number}} camera_position - Where camera is placed
 */

/**
 * AnnotationSystem class - manages annotations in 3D space
 */
export class AnnotationSystem {
    /**
     * @param {THREE.Scene} scene - Three.js scene
     * @param {THREE.Camera} camera - Three.js camera
     * @param {THREE.WebGLRenderer} renderer - Three.js renderer
     * @param {OrbitControls} controls - Orbit controls
     */
    constructor(scene, camera, renderer, controls) {
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
        this.onPlacementModeChanged = null;

        // Bind methods
        this._onClick = this._onClick.bind(this);

        this._createMarkerContainer();
    }

    /**
     * Create the DOM container for 2D annotation markers
     */
    _createMarkerContainer() {
        this.markerContainer = document.getElementById('annotation-markers');
        if (!this.markerContainer) {
            this.markerContainer = document.createElement('div');
            this.markerContainer.id = 'annotation-markers';
            document.body.appendChild(this.markerContainer);
        }
    }

    /**
     * Enable annotation placement mode
     */
    enablePlacementMode() {
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
    disablePlacementMode() {
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
    togglePlacementMode() {
        if (this.placementMode) {
            this.disablePlacementMode();
        } else {
            this.enablePlacementMode();
        }
    }

    /**
     * Handle click events for annotation placement
     */
    _onClick(event) {
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
        const validIntersects = intersects.filter(hit => {
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
    _getCurrentCameraState() {
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
    _showPendingMarker(screenX, screenY) {
        this._removePendingMarker();

        this.pendingMarkerEl = document.createElement('div');
        this.pendingMarkerEl.className = 'annotation-marker pending';
        this.pendingMarkerEl.textContent = '?';
        this.pendingMarkerEl.style.left = screenX + 'px';
        this.pendingMarkerEl.style.top = screenY + 'px';
        this.markerContainer.appendChild(this.pendingMarkerEl);
    }

    /**
     * Remove pending marker
     */
    _removePendingMarker() {
        if (this.pendingMarkerEl) {
            this.pendingMarkerEl.remove();
            this.pendingMarkerEl = null;
        }
    }

    /**
     * Confirm pending annotation with title and body
     * @param {string} id - Annotation ID
     * @param {string} title - Annotation title
     * @param {string} body - Annotation description
     * @returns {Annotation|null} The created annotation or null
     */
    confirmAnnotation(id, title, body) {
        if (!this.pendingPosition) return null;

        const cameraState = this._getCurrentCameraState();

        const annotation = {
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
    cancelAnnotation() {
        this._removePendingMarker();
        this.pendingPosition = null;
    }

    /**
     * Create a marker for an annotation
     */
    _createMarker(annotation, number) {
        const markerEl = document.createElement('div');
        markerEl.className = 'annotation-marker';
        markerEl.textContent = number;
        markerEl.dataset.annotationId = annotation.id;
        markerEl.addEventListener('click', () => this.selectAnnotation(annotation.id));

        this.markerContainer.appendChild(markerEl);

        this.markers.push({
            element: markerEl,
            annotation: annotation,
            position: new THREE.Vector3(
                annotation.position.x,
                annotation.position.y,
                annotation.position.z
            )
        });
    }

    /**
     * Update all marker screen positions
     * Call this in the animation loop
     */
    updateMarkerPositions() {
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
            }
        });
    }

    /**
     * Select an annotation
     * @param {string} id - Annotation ID
     */
    selectAnnotation(id) {
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
     * @param {string} id - Annotation ID
     * @param {number} duration - Animation duration in ms
     */
    goToAnnotation(id, duration = 1000) {
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

        const animate = () => {
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
     * @param {string} id - Annotation ID
     * @param {Object} updates - Fields to update
     */
    updateAnnotation(id, updates) {
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
     * @param {string} id - Annotation ID
     */
    updateAnnotationCamera(id) {
        const cameraState = this._getCurrentCameraState();
        return this.updateAnnotation(id, cameraState);
    }

    /**
     * Delete an annotation
     * @param {string} id - Annotation ID
     */
    deleteAnnotation(id) {
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
            m.element.textContent = i + 1;
        });

        if (this.selectedAnnotation?.id === id) {
            this.selectedAnnotation = null;
        }

        return true;
    }

    /**
     * Clear all annotations
     */
    clearAnnotations() {
        this.markers.forEach(m => m.element.remove());
        this.markers = [];
        this.annotations = [];
        this.selectedAnnotation = null;
        this.annotationCount = 0;
    }

    /**
     * Get all annotations
     * @returns {Annotation[]}
     */
    getAnnotations() {
        return [...this.annotations];
    }

    /**
     * Set annotations from array (e.g., loaded from archive)
     * @param {Annotation[]} annotations
     */
    setAnnotations(annotations) {
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
     * @returns {Annotation[]}
     */
    toJSON() {
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
     * @param {Annotation[]} data
     */
    fromJSON(data) {
        if (Array.isArray(data)) {
            this.setAnnotations(data);
        }
    }

    /**
     * Show/hide all markers
     * @param {boolean} visible
     */
    setMarkersVisible(visible) {
        this.markerContainer.style.display = visible ? 'block' : 'none';
    }

    /**
     * Check if there are any annotations
     * @returns {boolean}
     */
    hasAnnotations() {
        return this.annotations.length > 0;
    }

    /**
     * Get annotation count
     * @returns {number}
     */
    getCount() {
        return this.annotations.length;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        this.disablePlacementMode();
        this.clearAnnotations();
        if (this.markerContainer) {
            this.markerContainer.innerHTML = '';
        }
        this.scene.remove(this.markerGroup);
    }
}

export default AnnotationSystem;
