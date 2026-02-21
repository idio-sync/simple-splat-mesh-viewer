// Measurement System Module
// Handles point-to-point distance measurement in 3D space
// Session-only: measurements are not saved to archives

import * as THREE from 'three';

// Type aliases (same pattern as annotation-system.ts)
type Scene = any;
type Camera = any;
type WebGLRenderer = any;
type OrbitControls = any;

interface MeasurementEndpoint {
    position: THREE.Vector3;
    markerEl: HTMLElement;
}

interface ActiveMeasurement {
    id: string;
    pointA: MeasurementEndpoint;
    pointB: MeasurementEndpoint;
    rawDistance: number;       // Three.js scene units
    lineObject: THREE.Line;    // added to scene
    labelEl: HTMLElement;      // distance label div
}

/**
 * MeasurementSystem — click two points on the model to measure the distance.
 * Follows the same hybrid 2D/3D pattern as AnnotationSystem:
 *   - THREE.Line for the 3D connecting line (correct perspective)
 *   - DOM elements for endpoint labels and distance text (projected each frame)
 */
export class MeasurementSystem {
    scene: Scene;
    camera: Camera;
    renderer: WebGLRenderer;
    controls: OrbitControls;

    isActive: boolean;

    private measurements: ActiveMeasurement[];
    private pendingPointA: THREE.Vector3 | null;
    private pendingMarkerEl: HTMLElement | null;
    private measureCount: number;

    private scaleValue: number;
    private scaleUnit: string;

    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private markersContainer: HTMLElement | null;

    // Reusable vectors for midpoint calculation and projection
    private _mid: THREE.Vector3;
    private _projVec: THREE.Vector3;

    // Bound event handler
    private _onClick: (event: MouseEvent) => void;

    // Optional callback for mode changes (e.g. to update button state)
    onMeasureModeChanged: ((active: boolean) => void) | null;

    constructor(scene: Scene, camera: Camera, renderer: WebGLRenderer, controls: OrbitControls) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.controls = controls;

        this.isActive = false;
        this.measurements = [];
        this.pendingPointA = null;
        this.pendingMarkerEl = null;
        this.measureCount = 0;

        this.scaleValue = 1;
        this.scaleUnit = 'm';

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.markersContainer = null;
        this._mid = new THREE.Vector3();
        this._projVec = new THREE.Vector3();

        this.onMeasureModeChanged = null;

        this._onClick = this._onClickHandler.bind(this);
        this._createMarkersContainer();
    }

    // -------------------------------------------------------------------------
    // DOM container
    // -------------------------------------------------------------------------

    private _createMarkersContainer(): void {
        this.markersContainer = document.getElementById('measurement-markers') as HTMLElement | null;
        if (!this.markersContainer) {
            this.markersContainer = document.createElement('div');
            this.markersContainer.id = 'measurement-markers';
            document.body.appendChild(this.markersContainer);
        }
    }

    // -------------------------------------------------------------------------
    // Mode control
    // -------------------------------------------------------------------------

    setMeasureMode(active: boolean): void {
        this.isActive = active;

        if (active) {
            this.renderer.domElement.style.cursor = 'crosshair';
            this.renderer.domElement.addEventListener('click', this._onClick);
        } else {
            this.renderer.domElement.style.cursor = 'default';
            this.renderer.domElement.removeEventListener('click', this._onClick);
            this._removePendingMarker();
            this.pendingPointA = null;
        }

        if (this.onMeasureModeChanged) {
            this.onMeasureModeChanged(active);
        }
    }

    // -------------------------------------------------------------------------
    // Click handling (two-click flow: A → B)
    // -------------------------------------------------------------------------

    private _onClickHandler(event: MouseEvent): void {
        if (!this.isActive) return;
        if (event.target !== this.renderer.domElement) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.scene.children, true);

        // Filter out helpers, annotation markers, and measurement lines
        const valid = intersects.filter((hit: any) => {
            let obj = hit.object;
            while (obj) {
                if (obj.name === 'annotationMarkers' ||
                    obj.name === 'measurementLine' ||
                    obj.type === 'GridHelper' ||
                    obj.type === 'AxesHelper') {
                    return false;
                }
                obj = obj.parent;
            }
            return true;
        });

        if (valid.length === 0) return;

        const point = valid[0].point.clone();

        if (!this.pendingPointA) {
            // First click — store point A, show pending marker
            this.pendingPointA = point;
            this._showPendingMarker(event.clientX, event.clientY);
        } else {
            // Second click — complete measurement
            this._renderMeasurement(this.pendingPointA, point);
            this._removePendingMarker();
            this.pendingPointA = null;
        }
    }

    private _showPendingMarker(screenX: number, screenY: number): void {
        this._removePendingMarker();
        const el = document.createElement('div');
        el.className = 'measure-point measure-point-pending';
        el.textContent = 'A';
        el.style.left = screenX + 'px';
        el.style.top = screenY + 'px';
        this.markersContainer?.appendChild(el);
        this.pendingMarkerEl = el;
    }

    private _removePendingMarker(): void {
        if (this.pendingMarkerEl) {
            this.pendingMarkerEl.remove();
            this.pendingMarkerEl = null;
        }
    }

    // -------------------------------------------------------------------------
    // Render measurement (line + DOM labels)
    // -------------------------------------------------------------------------

    private _renderMeasurement(posA: THREE.Vector3, posB: THREE.Vector3): void {
        const id = `measure_${++this.measureCount}`;
        const rawDistance = posA.distanceTo(posB);

        // --- 3D line ---
        const geometry = new THREE.BufferGeometry().setFromPoints([posA, posB]);
        const material = new THREE.LineBasicMaterial({
            color: 0xFF6B35,
            depthTest: false,
            transparent: true,
            opacity: 0.9
        });
        const line = new THREE.Line(geometry, material);
        line.name = 'measurementLine';
        line.renderOrder = 999;
        this.scene.add(line);

        // --- DOM: endpoint A ---
        const markerA = document.createElement('div');
        markerA.className = 'measure-point measure-point-a';
        markerA.textContent = 'A';
        markerA.dataset.measureId = id;
        this.markersContainer?.appendChild(markerA);

        // --- DOM: endpoint B ---
        const markerB = document.createElement('div');
        markerB.className = 'measure-point measure-point-b';
        markerB.textContent = 'B';
        markerB.dataset.measureId = id;
        this.markersContainer?.appendChild(markerB);

        // --- DOM: distance label at midpoint ---
        const labelEl = document.createElement('div');
        labelEl.className = 'measure-label';
        labelEl.dataset.measureId = id;

        const distSpan = document.createElement('span');
        distSpan.className = 'measure-label-text';
        distSpan.textContent = this._getDisplayDistance(rawDistance);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'measure-label-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Remove measurement';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeMeasurement(id);
        });

        labelEl.appendChild(distSpan);
        labelEl.appendChild(deleteBtn);
        this.markersContainer?.appendChild(labelEl);

        this.measurements.push({
            id,
            pointA: { position: posA, markerEl: markerA },
            pointB: { position: posB, markerEl: markerB },
            rawDistance,
            lineObject: line,
            labelEl
        });
    }

    // -------------------------------------------------------------------------
    // Scale
    // -------------------------------------------------------------------------

    private _getDisplayDistance(rawDistance: number): string {
        const converted = rawDistance * this.scaleValue;
        return `${parseFloat(converted.toFixed(3))} ${this.scaleUnit}`;
    }

    setScale(value: number, unit: string): void {
        if (isNaN(value) || value <= 0) return;
        this.scaleValue = value;
        this.scaleUnit = unit;
        // Update all existing labels
        for (const m of this.measurements) {
            const textEl = m.labelEl.querySelector('.measure-label-text') as HTMLElement | null;
            if (textEl) textEl.textContent = this._getDisplayDistance(m.rawDistance);
        }
    }

    // -------------------------------------------------------------------------
    // Per-frame update (call from animate loop)
    // -------------------------------------------------------------------------

    updateMarkerPositions(): void {
        if (this.measurements.length === 0) return;

        const rect = this.renderer.domElement.getBoundingClientRect();

        for (const m of this.measurements) {
            this._projectPoint(m.pointA.markerEl, m.pointA.position, rect);
            this._projectPoint(m.pointB.markerEl, m.pointB.position, rect);

            // Label at geometric midpoint of A and B
            this._mid.addVectors(m.pointA.position, m.pointB.position).multiplyScalar(0.5);
            const midScreen = this._projVec.copy(this._mid).project(this.camera);

            if (midScreen.z > 1) {
                m.labelEl.style.display = 'none';
            } else {
                const mx = (midScreen.x * 0.5 + 0.5) * rect.width + rect.left;
                const my = (-midScreen.y * 0.5 + 0.5) * rect.height + rect.top;
                m.labelEl.style.display = 'flex';
                m.labelEl.style.left = mx + 'px';
                m.labelEl.style.top = my + 'px';
            }
        }
    }

    private _projectPoint(el: HTMLElement, pos: THREE.Vector3, rect: DOMRect): void {
        const screenPos = this._projVec.copy(pos).project(this.camera);
        if (screenPos.z > 1) {
            el.style.display = 'none';
        } else {
            const x = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
            const y = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top;
            el.style.display = 'flex';
            el.style.left = x + 'px';
            el.style.top = y + 'px';
        }
    }

    // -------------------------------------------------------------------------
    // Removal
    // -------------------------------------------------------------------------

    removeMeasurement(id: string): void {
        const idx = this.measurements.findIndex(m => m.id === id);
        if (idx === -1) return;

        const m = this.measurements[idx];
        this.scene.remove(m.lineObject);
        m.lineObject.geometry.dispose();
        (m.lineObject.material as THREE.Material).dispose();
        m.pointA.markerEl.remove();
        m.pointB.markerEl.remove();
        m.labelEl.remove();
        this.measurements.splice(idx, 1);
    }

    clearAll(): void {
        for (let i = this.measurements.length - 1; i >= 0; i--) {
            this.removeMeasurement(this.measurements[i].id);
        }
        this._removePendingMarker();
        this.pendingPointA = null;
    }

    // -------------------------------------------------------------------------
    // Renderer hot-swap (WebGPU <-> WebGL)
    // -------------------------------------------------------------------------

    updateRenderer(newRenderer: any): void {
        if (this.renderer?.domElement) {
            this.renderer.domElement.removeEventListener('click', this._onClick);
            if (this.isActive) this.renderer.domElement.style.cursor = '';
        }
        this.renderer = newRenderer;
        if (this.isActive && this.renderer?.domElement) {
            this.renderer.domElement.addEventListener('click', this._onClick);
            this.renderer.domElement.style.cursor = 'crosshair';
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    dispose(): void {
        this.setMeasureMode(false);
        this.clearAll();
        if (this.markersContainer) {
            this.markersContainer.innerHTML = '';
        }
    }
}

export default MeasurementSystem;
