/**
 * Interactive map picker for GPS coordinate selection.
 * Uses Leaflet + OpenStreetMap tiles + Nominatim geocoding.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons in Vite bundler
// (Leaflet expects icon images at a path relative to CSS, which Vite breaks)
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

import { Logger } from './utilities.js';

const log = Logger.getLogger('map-picker');

interface MapPickerOptions {
    lat?: number;
    lon?: number;
    onConfirm: (lat: number, lon: number, locationName?: string) => void;
}

let map: L.Map | null = null;
let marker: L.Marker | null = null;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Reverse geocode coordinates via Nominatim (free OSM service).
 * Returns a human-readable location name, or null on failure.
 */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
    try {
        const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`,
            { headers: { 'Accept-Language': 'en' } }
        );
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.display_name || null;
    } catch (err) {
        log.warn('Reverse geocode failed:', err);
        return null;
    }
}

/**
 * Search for a location by name via Nominatim.
 */
async function searchLocation(query: string): Promise<Array<{ lat: number; lon: number; display_name: string }>> {
    try {
        const resp = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
            { headers: { 'Accept-Language': 'en' } }
        );
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.map((r: any) => ({
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
            display_name: r.display_name
        }));
    } catch (err) {
        log.warn('Location search failed:', err);
        return [];
    }
}

/**
 * Open the map picker modal.
 */
export function openMapPicker(options: MapPickerOptions): void {
    const { lat, lon, onConfirm } = options;

    // Get modal elements
    const overlay = document.getElementById('map-picker-overlay');
    const mapContainer = document.getElementById('map-picker-map');
    const searchInput = document.getElementById('map-picker-search') as HTMLInputElement | null;
    const searchResults = document.getElementById('map-picker-results');
    const coordDisplay = document.getElementById('map-picker-coords');
    const locationDisplay = document.getElementById('map-picker-location');
    const confirmBtn = document.getElementById('map-picker-confirm');
    const cancelBtn = document.getElementById('map-picker-cancel');
    const locateBtn = document.getElementById('map-picker-locate');

    if (!overlay || !mapContainer) {
        log.error('Map picker modal elements not found');
        return;
    }

    // Show modal
    overlay.classList.remove('hidden');

    // Track picked location
    let pickedLat: number | null = lat ?? null;
    let pickedLon: number | null = lon ?? null;
    let pickedName: string | undefined;

    // Default center: provided coords, or world view
    const hasCoords = lat !== undefined && lon !== undefined;
    const defaultLat = lat ?? 40;
    const defaultLon = lon ?? 0;
    const defaultZoom = hasCoords ? 14 : 2;

    // Create or reset map
    if (map) {
        map.remove();
        map = null;
    }
    marker = null;

    // Small delay to ensure modal is rendered before map init
    requestAnimationFrame(() => {
        map = L.map(mapContainer!, {
            center: [defaultLat, defaultLon],
            zoom: defaultZoom,
            zoomControl: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            maxZoom: 19,
        }).addTo(map);

        // Place initial marker if coordinates provided
        if (hasCoords) {
            marker = L.marker([lat, lon], { draggable: true }).addTo(map);
            updateCoordDisplay(lat, lon);
            setupMarkerDrag();
        }

        // Click to place/move marker
        map.on('click', (e: L.LeafletMouseEvent) => {
            const { lat: clickLat, lng: clickLon } = e.latlng;
            placeMarker(clickLat, clickLon);
        });

        // Force a resize after the map is visible
        setTimeout(() => map?.invalidateSize(), 100);
    });

    function placeMarker(newLat: number, newLon: number) {
        pickedLat = newLat;
        pickedLon = newLon;
        updateCoordDisplay(newLat, newLon);

        if (marker && map) {
            marker.setLatLng([newLat, newLon]);
        } else if (map) {
            marker = L.marker([newLat, newLon], { draggable: true }).addTo(map);
            setupMarkerDrag();
        }

        // Reverse geocode in background
        reverseGeocode(newLat, newLon).then(name => {
            if (name) {
                pickedName = name;
                if (locationDisplay) {
                    locationDisplay.textContent = name;
                    locationDisplay.title = name;
                }
            }
        });
    }

    function setupMarkerDrag() {
        if (!marker) return;
        marker.on('dragend', () => {
            const pos = marker!.getLatLng();
            pickedLat = pos.lat;
            pickedLon = pos.lng;
            updateCoordDisplay(pos.lat, pos.lng);
            reverseGeocode(pos.lat, pos.lng).then(name => {
                if (name) {
                    pickedName = name;
                    if (locationDisplay) {
                        locationDisplay.textContent = name;
                        locationDisplay.title = name;
                    }
                }
            });
        });
    }

    function updateCoordDisplay(lat: number, lon: number) {
        if (coordDisplay) {
            coordDisplay.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        }
        if (confirmBtn) {
            (confirmBtn as HTMLButtonElement).disabled = false;
        }
    }

    // Search input with debounce
    function handleSearch() {
        if (!searchInput || !searchResults) return;
        const query = searchInput.value.trim();
        if (query.length < 2) {
            searchResults.innerHTML = '';
            searchResults.classList.add('hidden');
            return;
        }

        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(async () => {
            const results = await searchLocation(query);
            searchResults.innerHTML = '';
            if (results.length === 0) {
                searchResults.classList.add('hidden');
                return;
            }
            searchResults.classList.remove('hidden');
            for (const result of results) {
                const item = document.createElement('div');
                item.className = 'map-search-result';
                item.textContent = result.display_name;
                item.title = result.display_name;
                item.addEventListener('click', () => {
                    placeMarker(result.lat, result.lon);
                    pickedName = result.display_name;
                    if (locationDisplay) {
                        locationDisplay.textContent = result.display_name;
                        locationDisplay.title = result.display_name;
                    }
                    map?.setView([result.lat, result.lon], 14);
                    searchResults.innerHTML = '';
                    searchResults.classList.add('hidden');
                    if (searchInput) searchInput.value = '';
                });
                searchResults.appendChild(item);
            }
        }, 400);
    }

    // Use device location
    function handleLocate() {
        if (!navigator.geolocation) {
            log.warn('Geolocation not available');
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                placeMarker(latitude, longitude);
                map?.setView([latitude, longitude], 14);
            },
            (err) => log.warn('Geolocation failed:', err.message),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }

    // Close modal
    function closeModal() {
        overlay.classList.add('hidden');
        if (searchInput) searchInput.value = '';
        if (searchResults) {
            searchResults.innerHTML = '';
            searchResults.classList.add('hidden');
        }
        if (locationDisplay) locationDisplay.textContent = '';
        if (coordDisplay) coordDisplay.textContent = 'Click map to place marker';
        if (confirmBtn) (confirmBtn as HTMLButtonElement).disabled = true;
        // Clean up event listeners
        searchInput?.removeEventListener('input', handleSearch);
        confirmBtn?.removeEventListener('click', handleConfirm);
        cancelBtn?.removeEventListener('click', closeModal);
        locateBtn?.removeEventListener('click', handleLocate);
        overlay.removeEventListener('click', handleOverlayClick);
    }

    function handleConfirm() {
        if (pickedLat !== null && pickedLon !== null) {
            onConfirm(pickedLat, pickedLon, pickedName);
        }
        closeModal();
    }

    function handleOverlayClick(e: Event) {
        if (e.target === overlay) closeModal();
    }

    // Wire event listeners
    searchInput?.addEventListener('input', handleSearch);
    confirmBtn?.addEventListener('click', handleConfirm);
    cancelBtn?.addEventListener('click', closeModal);
    locateBtn?.addEventListener('click', handleLocate);
    overlay.addEventListener('click', handleOverlayClick);

    log.info('Map picker opened');
}
