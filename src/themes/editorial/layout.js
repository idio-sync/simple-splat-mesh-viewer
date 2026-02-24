/**
 * Editorial Layout — self-contained layout module for the editorial theme.
 *
 * No ES imports — receives ALL dependencies via the `deps` object passed to
 * setup(). This avoids path-resolution issues between online (relative to
 * theme folder) and offline (blob URLs) modes.
 *
 * Self-registers on window.__KIOSK_LAYOUTS__ so the kiosk bootstrap can
 * discover it without dynamic import() in offline viewers.
 */

// ---- Private helpers (duplicated because originals are module-private) ----

function formatDate(raw, style) {
    if (!raw) return raw;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    if (style === 'medium') {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function hasValue(val) {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') {
        return Object.keys(val).filter(k => !k.startsWith('_')).some(k => hasValue(val[k]));
    }
    return true;
}

// ---- Static tile map (no Leaflet — pure DOM + Web Mercator math) ----

/**
 * Render a static OpenStreetMap tile map centered on the given coordinates.
 * Creates a 3×3 grid of 256 px tiles, positions via CSS transform so the
 * target point sits at the container's center, and resolves when done.
 *
 * @param {number} lat  Latitude in degrees
 * @param {number} lng  Longitude in degrees
 * @param {HTMLElement} container  Map container (must be in the DOM)
 * @param {number} [zoom=15]  Tile zoom level
 * @returns {Promise<boolean>} true if at least one tile loaded
 */
function createStaticMap(lat, lng, container, zoom) {
    zoom = zoom || 15;
    var TILE = 256;
    var n = Math.pow(2, zoom);

    // Web Mercator: lat/lng → continuous tile coordinates
    var tileXf = (lng + 180) / 360 * n;
    var latRad = lat * Math.PI / 180;
    var tileYf = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
    tileYf = Math.max(0, Math.min(n - 1, tileYf)); // clamp near poles

    var cx = Math.floor(tileXf);
    var cy = Math.floor(tileYf);
    var offX = (tileXf - cx) * TILE;
    var offY = (tileYf - cy) * TILE;

    var COLS = 3, ROWS = 3;
    var subs = ['a', 'b', 'c'];
    var wrapper = document.createElement('div');
    wrapper.className = 'editorial-map-tiles';

    var loaded = 0, failed = 0, total = COLS * ROWS;

    return new Promise(function (resolve) {
        var timer = setTimeout(function () { if (loaded === 0) resolve(false); }, 4000);

        function check() {
            if (loaded + failed === total) {
                clearTimeout(timer);
                resolve(loaded > 0);
            }
        }

        for (var row = 0; row < ROWS; row++) {
            for (var col = 0; col < COLS; col++) {
                var tx = cx - 1 + col;          // one tile left of center
                var ty = cy - 1 + row;           // one tile above center
                tx = ((tx % n) + n) % n;        // wrap at date line
                if (ty < 0 || ty >= n) { total--; continue; }

                var img = document.createElement('img');
                img.className = 'editorial-map-tile';
                img.alt = '';
                img.draggable = false;
                img.style.gridColumn = String(col + 1);
                img.style.gridRow = String(row + 1);
                img.src = 'https://' + subs[(tx + ty) % 3] +
                    '.tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
                img.onload = function () { loaded++; check(); };
                img.onerror = function () { failed++; this.style.display = 'none'; check(); };
                wrapper.appendChild(img);
            }
        }

        container.appendChild(wrapper);

        // Position grid so the target coordinate is at container center
        requestAnimationFrame(function () {
            var cw = container.clientWidth || 360;
            var ch = container.clientHeight || 170;
            var targetGX = 1 * TILE + offX;   // col 1 is the center tile
            var targetGY = 1 * TILE + offY;   // row 1 is the center row
            wrapper.style.transform =
                'translate(' + (cw / 2 - targetGX) + 'px,' + (ch / 2 - targetGY) + 'px)';
        });
    });
}

// ---- Auto-fade behavior ----

function setupAutoFade(titleBlock, cornerElement) {
    let fadeTimer;
    const elements = [titleBlock, cornerElement].filter(Boolean);

    const fadeIn = () => {
        elements.forEach(el => { el.style.opacity = '1'; });
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => {
            elements.forEach(el => { el.style.opacity = '0.15'; });
        }, 4000);
    };

    document.addEventListener('mousemove', fadeIn);
    fadeTimer = setTimeout(() => {
        elements.forEach(el => { el.style.opacity = '0.15'; });
    }, 4000);
}

// ---- Info panel (side panel with image strip) ----

function createCollapsible(title, openByDefault) {
    const section = document.createElement('div');
    section.className = 'editorial-collapsible' + (openByDefault ? ' open' : '');
    const header = document.createElement('div');
    header.className = 'editorial-collapsible-header';
    header.innerHTML = `<span class="editorial-collapsible-title">${title}</span><span class="editorial-collapsible-chevron">&#9654;</span>`;
    header.addEventListener('click', () => section.classList.toggle('open'));
    section.appendChild(header);
    const content = document.createElement('div');
    content.className = 'editorial-collapsible-content';
    const inner = document.createElement('div');
    inner.className = 'editorial-collapsible-inner';
    content.appendChild(inner);
    section.appendChild(content);
    return { section, content: inner };
}

function createQualityDetail(label, value, extraClass) {
    const el = document.createElement('div');
    el.className = 'editorial-quality-detail';
    el.innerHTML = `<span class="editorial-quality-label">${label}</span><span class="editorial-quality-value${extraClass || ''}">${value}</span>`;
    return el;
}

function createSubjectDetail(label, value) {
    const el = document.createElement('div');
    el.className = 'editorial-subject-detail';
    el.innerHTML = `<span class="editorial-subject-label">${label}</span><span class="editorial-subject-value">${value}</span>`;
    return el;
}

function createTechDetail(label, value) {
    const el = document.createElement('div');
    el.className = 'editorial-tech-detail';
    el.innerHTML = `<span class="editorial-tech-label">${label}</span><span class="editorial-tech-value">${value}</span>`;
    return el;
}

function createInfoOverlay(manifest, deps) {
    const { escapeHtml, parseMarkdown, resolveAssetRefs, state, annotationSystem, modelGroup } = deps;

    const metadataProfile = deps.metadataProfile || 'archival';
    const shouldShow = (title) => {
        const tiers = deps.EDITORIAL_SECTION_TIERS;
        const tier = tiers?.[title];
        if (!tier || !deps.isTierVisible) return true;
        return deps.isTierVisible(tier, metadataProfile);
    };

    const overlay = document.createElement('div');
    overlay.className = 'editorial-info-overlay';

    const panelInner = document.createElement('div');
    panelInner.className = 'editorial-panel-inner';

    // --- Image strip ---
    const imageAssets = state.imageAssets || {};
    const desc = manifest?.description || manifest?.project?.description || '';
    let stripSrc = null;
    const assetKeys = Object.keys(imageAssets);
    if (assetKeys.length > 0) {
        stripSrc = imageAssets['preview.jpg'] || imageAssets['preview.png'] || imageAssets[assetKeys[0]];
    }
    if (!stripSrc && desc) {
        const tmp = document.createElement('div');
        tmp.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        const firstImg = tmp.querySelector('img');
        if (firstImg) stripSrc = firstImg.src;
    }

    const imageStrip = document.createElement('div');
    imageStrip.className = 'editorial-image-strip';
    const stripAccent = document.createElement('div');
    stripAccent.className = 'editorial-strip-accent';

    if (stripSrc) {
        const stripImg = document.createElement('img');
        stripImg.src = stripSrc;
        stripImg.alt = '';
        stripImg.draggable = false;
        imageStrip.appendChild(stripImg);
        panelInner.appendChild(imageStrip);
        panelInner.appendChild(stripAccent);
    }

    // --- Close button ---
    const closeBtn = document.createElement('button');
    closeBtn.className = 'editorial-info-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('open');
        const detailsBtn = document.querySelector('.editorial-details-link');
        if (detailsBtn) detailsBtn.classList.remove('active');
    });
    panelInner.appendChild(closeBtn);

    // --- Scrollable content ---
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'editorial-info-content';

    // === Title block ===
    const headerSection = document.createElement('div');
    headerSection.className = 'editorial-info-header';

    const infoTitleEl = document.createElement('h2');
    infoTitleEl.className = 'editorial-info-title';
    infoTitleEl.textContent = 'Info';
    headerSection.appendChild(infoTitleEl);

    const titleBar = document.createElement('div');
    titleBar.className = 'editorial-info-title-bar';
    headerSection.appendChild(titleBar);

    // Model stats
    if (modelGroup && modelGroup.children.length > 0) {
        let vertexCount = 0, textureSet = new Set(), maxTexRes = 0;
        modelGroup.traverse(child => {
            if (child.isMesh && child.geometry) {
                const geo = child.geometry;
                if (geo.attributes.position) vertexCount += geo.attributes.position.count;
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    if (m) {
                        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(t => {
                            const tex = m[t];
                            if (tex && !textureSet.has(tex)) {
                                textureSet.add(tex);
                                const img = tex.image;
                                if (img && img.width) maxTexRes = Math.max(maxTexRes, img.width, img.height);
                            }
                        });
                    }
                });
            }
        });
        if (vertexCount > 0) {
            const parts = [];
            const fmt = (n) => n >= 1000000 ? (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M' : n.toLocaleString();
            parts.push(`<strong>${fmt(vertexCount)}</strong> vertices`);
            if (textureSet.size > 0) parts.push(`<strong>${textureSet.size}</strong> textures @ ${maxTexRes}\u00B2`);
            const annoCount = annotationSystem ? annotationSystem.getAnnotations().length : 0;
            if (annoCount > 0) parts.push(`<strong>${annoCount}</strong> annotations`);

            const statsEl = document.createElement('div');
            statsEl.className = 'editorial-info-model-stats';
            statsEl.innerHTML = parts.join(' \u00B7 ');
            headerSection.appendChild(statsEl);
        }
    }

    contentWrapper.appendChild(headerSection);

    // === Description (reading zone) ===
    if (desc) {
        const descEl = document.createElement('div');
        descEl.className = 'editorial-info-description';
        descEl.innerHTML = parseMarkdown(resolveAssetRefs(desc, imageAssets));
        // Remove first image if it's already shown in the image strip
        if (stripSrc) {
            const firstImg = descEl.querySelector('img');
            if (firstImg) {
                // Remove if src matches strip, or if strip was extracted from description
                const parent = firstImg.parentElement;
                firstImg.remove();
                // Clean up empty <p> wrapper left behind
                if (parent && parent.tagName === 'P' && parent.textContent.trim() === '') parent.remove();
            }
        }
        contentWrapper.appendChild(descEl);
    }

    // === Collapsible: The Subject ===
    const ar = manifest?.archival_record;
    if (ar && hasValue(ar) && shouldShow('The Subject')) {
        const { section, content } = createCollapsible('The Subject', false);

        const subjectGrid = document.createElement('div');
        subjectGrid.className = 'editorial-subject-grid';
        const creation = ar.creation || {};
        const phys = ar.physical_description || {};
        if (creation.creator) subjectGrid.appendChild(createSubjectDetail('Creator', escapeHtml(creation.creator)));
        const creationDate = creation.date || creation.date_created;
        if (creationDate) subjectGrid.appendChild(createSubjectDetail('Date', escapeHtml(String(creationDate))));
        if (creation.period) subjectGrid.appendChild(createSubjectDetail('Period', escapeHtml(creation.period)));
        if (creation.culture) subjectGrid.appendChild(createSubjectDetail('Culture', escapeHtml(creation.culture)));
        if (phys.medium) subjectGrid.appendChild(createSubjectDetail('Medium', escapeHtml(phys.medium)));
        if (phys.dimensions) {
            const d = phys.dimensions;
            const dimStr = typeof d === 'object'
                ? [d.height, d.width, d.depth].filter(Boolean).join(' × ') || JSON.stringify(d)
                : String(d);
            subjectGrid.appendChild(createSubjectDetail('Dimensions', escapeHtml(dimStr)));
        }
        if (phys.condition) subjectGrid.appendChild(createSubjectDetail('Condition', escapeHtml(phys.condition)));
        if (subjectGrid.children.length > 0) content.appendChild(subjectGrid);

        // Location block — combines location name + static tile map
        const subjLocation = ar.coverage?.spatial?.place || ar.coverage?.spatial?.location_name || manifest?.location;
        const coords = manifest?.coordinates || ar.coverage?.spatial?.coordinates;
        if (subjLocation || coords) {
            const locLabeled = document.createElement('div');
            locLabeled.className = 'editorial-prose-labeled';
            const locLabel = document.createElement('div');
            locLabel.className = 'editorial-prose-sub-label';
            locLabel.textContent = 'Location';
            locLabeled.appendChild(locLabel);

            // Location name text
            if (subjLocation) {
                const locName = document.createElement('div');
                locName.className = 'editorial-location-name';
                locName.textContent = subjLocation;
                locLabeled.appendChild(locName);
            }

            // GPS coordinates — static tile map with graceful fallback
            if (coords) {
                let lat, lng;
                if (Array.isArray(coords) && coords.length >= 2) {
                    lat = coords[0]; lng = coords[1];
                } else {
                    lat = coords.latitude || coords.lat;
                    lng = coords.longitude || coords.lng || coords.lon;
                }
                if (lat != null && lng != null) {
                    lat = parseFloat(String(lat));
                    lng = parseFloat(String(lng));
                    if (!isNaN(lat) && !isNaN(lng)) {
                        const mapContainer = document.createElement('div');
                        mapContainer.className = 'editorial-map-placeholder';

                        const latDir = lat >= 0 ? 'N' : 'S';
                        const lngDir = lng >= 0 ? 'E' : 'W';
                        const latStr = escapeHtml(Math.abs(lat).toFixed(6));
                        const lngStr = escapeHtml(Math.abs(lng).toFixed(6));

                        const pin = document.createElement('div');
                        pin.className = 'editorial-map-pin-overlay';
                        pin.innerHTML = '<svg width="20" height="28" viewBox="0 0 24 34" fill="none"><path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 22 12 22s12-13 12-22C24 5.37 18.63 0 12 0zm0 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="currentColor"/></svg>';

                        const footer = document.createElement('div');
                        footer.className = 'editorial-map-footer';
                        footer.innerHTML =
                            '<span class="editorial-map-coords">' + latStr + '\u00B0' + latDir + ', ' + lngStr + '\u00B0' + lngDir + '</span>' +
                            '<span class="editorial-map-attribution">\u00A9 OpenStreetMap</span>';

                        mapContainer.appendChild(pin);
                        mapContainer.appendChild(footer);
                        locLabeled.appendChild(mapContainer);

                        createStaticMap(lat, lng, mapContainer, 15).then(function (ok) {
                            mapContainer.classList.add(ok ? 'editorial-map-loaded' : 'editorial-map-fallback');
                        });
                    }
                }
            }

            content.appendChild(locLabeled);
        }

        // Historical context prose
        if (ar.context?.description) {
            const proseLabeled = document.createElement('div');
            proseLabeled.className = 'editorial-prose-labeled';
            const subLabel = document.createElement('div');
            subLabel.className = 'editorial-prose-sub-label';
            subLabel.textContent = 'Historical Context';
            proseLabeled.appendChild(subLabel);
            const proseBlock = document.createElement('div');
            proseBlock.className = 'editorial-prose-block';
            proseBlock.innerHTML = parseMarkdown(ar.context.description);
            proseLabeled.appendChild(proseBlock);
            content.appendChild(proseLabeled);
        }

        // Provenance prose
        if (ar.provenance) {
            const proseLabeled = document.createElement('div');
            proseLabeled.className = 'editorial-prose-labeled';
            const subLabel = document.createElement('div');
            subLabel.className = 'editorial-prose-sub-label';
            subLabel.textContent = 'Provenance';
            proseLabeled.appendChild(subLabel);
            const proseBlock = document.createElement('div');
            proseBlock.className = 'editorial-prose-block';
            proseBlock.innerHTML = parseMarkdown(ar.provenance);
            proseLabeled.appendChild(proseBlock);
            content.appendChild(proseLabeled);
        }

        contentWrapper.appendChild(section);
    }

    // === Collapsible: Quality & Capture ===
    const qm = manifest?.quality_metrics;
    const prov = manifest?.provenance;
    const hasQuality = qm && hasValue(qm);
    const hasCapture = prov && (prov.capture_device || prov.device_serial);
    const operator = manifest?.creator || prov?.operator;
    if ((hasQuality || hasCapture || operator) && shouldShow('Quality & Capture')) {
        const { section, content } = createCollapsible('Quality & Capture', false);

        // Operator credit line
        if (operator) {
            const creditLine = document.createElement('div');
            creditLine.className = 'editorial-info-credit-line';
            creditLine.innerHTML = `<span class="org">${escapeHtml(operator)}</span>`;
            content.appendChild(creditLine);
        }

        // 3-column quality grid
        const qualityGrid = document.createElement('div');
        qualityGrid.className = 'editorial-quality-grid';
        if (qm) {
            if (qm.tier) qualityGrid.appendChild(createQualityDetail('Tier', escapeHtml(String(qm.tier))));
            if (qm.accuracy_grade) qualityGrid.appendChild(createQualityDetail('Accuracy', escapeHtml(`Grade ${qm.accuracy_grade}`)));
            if (qm.capture_resolution?.value != null) {
                const cr = qm.capture_resolution;
                qualityGrid.appendChild(createQualityDetail('Resolution', escapeHtml(`${cr.value}${cr.unit || ''} GSD`)));
            }
            if (qm.alignment_error?.value != null) {
                const ae = qm.alignment_error;
                qualityGrid.appendChild(createQualityDetail('Alignment', escapeHtml(`${ae.value}${ae.unit || ''} RMSE`)));
            }
            if (qm.scale_verification) qualityGrid.appendChild(createQualityDetail('Scale Check', escapeHtml(qm.scale_verification)));
        }
        if (prov?.capture_device) qualityGrid.appendChild(createQualityDetail('Device', escapeHtml(prov.capture_device)));
        if (prov?.device_serial) {
            const serialEl = createQualityDetail('Serial', escapeHtml(prov.device_serial));
            const valSpan = serialEl.querySelector('.editorial-quality-value');
            if (valSpan) {
                valSpan.style.fontFamily = 'var(--kiosk-font-mono)';
                valSpan.style.fontSize = '0.68rem';
                valSpan.style.letterSpacing = '0.01em';
            }
            qualityGrid.appendChild(serialEl);
        }
        if (qualityGrid.children.length > 0) content.appendChild(qualityGrid);

        // Secondary quality grid (data_quality sub-fields)
        if (qm && hasValue(qm.data_quality)) {
            const secGrid = document.createElement('div');
            secGrid.className = 'editorial-quality-secondary';
            Object.keys(qm.data_quality).forEach(k => {
                secGrid.appendChild(createQualityDetail(
                    escapeHtml(k.replace(/_/g, ' ')),
                    escapeHtml(String(qm.data_quality[k]))
                ));
            });
            content.appendChild(secGrid);
        }

        contentWrapper.appendChild(section);
    }

    // === Collapsible: Processing ===
    if (prov && shouldShow('Processing')) {
        const hasSoftware = Array.isArray(prov.processing_software) && prov.processing_software.length > 0;
        const hasNotes = !!prov.processing_notes;
        if (hasSoftware || hasNotes) {
            const { section, content } = createCollapsible('Processing', false);

            if (hasSoftware) {
                const swLine = document.createElement('div');
                swLine.className = 'editorial-software-line';
                const names = prov.processing_software.map(sw =>
                    typeof sw === 'object' ? `${sw.name || ''}${sw.version ? ' ' + sw.version : ''}`.trim() : sw
                ).filter(Boolean);
                swLine.innerHTML = `<strong>Software</strong> ${escapeHtml(names.join(' \u00B7 '))}`;
                content.appendChild(swLine);
            }

            if (hasNotes) {
                const proseBlock = document.createElement('div');
                proseBlock.className = 'editorial-prose-block';
                proseBlock.innerHTML = parseMarkdown(prov.processing_notes);
                content.appendChild(proseBlock);
            }

            contentWrapper.appendChild(section);
        }
    }

    // === Collapsible: Data Assets ===
    let entries = manifest?.data_entries;
    // Normalize object-keyed entries to array (manifest may use {scene_0: {...}, mesh_0: {...}} format)
    if (entries && !Array.isArray(entries) && typeof entries === 'object') {
        entries = Object.values(entries).filter(e => e && typeof e === 'object');
    }
    if (Array.isArray(entries) && entries.length > 0 && shouldShow('Data Assets')) {
        const { section, content } = createCollapsible('Data Assets', false);

        entries.forEach(entry => {
            const item = document.createElement('div');
            item.className = 'editorial-asset-item';

            const headerEl = document.createElement('div');
            headerEl.className = 'editorial-asset-header';
            if (entry.role) {
                const roleEl = document.createElement('span');
                roleEl.className = 'editorial-asset-role';
                roleEl.textContent = entry.role;
                headerEl.appendChild(roleEl);
            }
            const nameEl = document.createElement('span');
            nameEl.className = 'editorial-asset-filename';
            nameEl.textContent = entry.file_name || entry.filename || '';
            headerEl.appendChild(nameEl);
            item.appendChild(headerEl);

            const entryCreator = entry.creator || entry.created_by;
            if (entryCreator) {
                const creatorEl = document.createElement('div');
                creatorEl.className = 'editorial-asset-creator';
                creatorEl.textContent = entryCreator;
                item.appendChild(creatorEl);
            }

            // Meta chips (file size, counts)
            const metaChips = [];
            if (entry.file_size) metaChips.push(entry.file_size);
            if (entry.splat_count) metaChips.push(`${Number(entry.splat_count).toLocaleString()} splats`);
            if (entry.polygon_count) metaChips.push(`${Number(entry.polygon_count).toLocaleString()} polygons`);
            if (entry.vertex_count) metaChips.push(`${Number(entry.vertex_count).toLocaleString()} vertices`);
            if (metaChips.length > 0) {
                const metaRow = document.createElement('div');
                metaRow.className = 'editorial-asset-meta';
                metaChips.forEach(chip => {
                    const chipEl = document.createElement('span');
                    chipEl.className = 'editorial-asset-meta-chip';
                    chipEl.textContent = chip;
                    metaRow.appendChild(chipEl);
                });
                item.appendChild(metaRow);
            }

            // Source notes
            if (entry._source_notes) {
                const notesEl = document.createElement('div');
                notesEl.className = 'editorial-asset-notes';
                notesEl.textContent = entry._source_notes;
                item.appendChild(notesEl);
            }

            content.appendChild(item);
        });

        contentWrapper.appendChild(section);
    }

    // === Collapsible: Technical Details ===
    if (shouldShow('Technical Details')) {
        const hasTech = ar || manifest?.material_standard || manifest?.preservation || manifest?.integrity;
        if (hasTech) {
            const { section, content } = createCollapsible('Technical Details', false);

            const techGrid = document.createElement('div');
            techGrid.className = 'editorial-tech-grid';
            if (ar?.standard) techGrid.appendChild(createTechDetail('Standard', escapeHtml(ar.standard)));
            const copyrightVal = ar?.rights?.holder || ar?.rights?.copyright_status;
            if (copyrightVal) techGrid.appendChild(createTechDetail('Copyright', escapeHtml(copyrightVal)));
            const matStd = manifest?.material_standard;
            if (matStd) {
                if (matStd.workflow) techGrid.appendChild(createTechDetail('Material', escapeHtml(matStd.workflow)));
                if (matStd.color_space) techGrid.appendChild(createTechDetail('Color Space', escapeHtml(matStd.color_space)));
                const normalVal = matStd.normal_convention || matStd.normal_space;
                if (normalVal) techGrid.appendChild(createTechDetail('Normal', escapeHtml(normalVal)));
            }
            const pres = manifest?.preservation;
            if (pres?.rendering_requirements) techGrid.appendChild(createTechDetail('Rendering', escapeHtml(pres.rendering_requirements)));
            if (techGrid.children.length > 0) content.appendChild(techGrid);

            // Significant properties
            if (pres?.significant_properties?.length > 0) {
                const subHead = document.createElement('div');
                subHead.className = 'editorial-tech-sub-header';
                subHead.textContent = 'Significant Properties';
                content.appendChild(subHead);
                const propsRow = document.createElement('div');
                propsRow.className = 'editorial-sig-props';
                pres.significant_properties.forEach(prop => {
                    const chip = document.createElement('span');
                    chip.className = 'editorial-sig-prop';
                    chip.textContent = prop;
                    propsRow.appendChild(chip);
                });
                content.appendChild(propsRow);
            }

            // Integrity hashes — supports both {checksums: [{file, hash}]} and {assets: {file: hash}} formats
            const integ = manifest?.integrity;
            let hashEntries = [];
            if (Array.isArray(integ?.checksums) && integ.checksums.length > 0) {
                hashEntries = integ.checksums.map(cs => ({ file: cs.file || '', hash: cs.hash || cs.value || '' }));
            } else if (integ?.assets && typeof integ.assets === 'object') {
                hashEntries = Object.entries(integ.assets).map(([file, hash]) => ({ file, hash: String(hash) }));
            }
            if (hashEntries.length > 0) {
                const subHead = document.createElement('div');
                subHead.className = 'editorial-tech-sub-header';
                subHead.textContent = `Integrity \u2014 ${escapeHtml(integ.algorithm || 'SHA-256')}`;
                content.appendChild(subHead);
                const hashList = document.createElement('ul');
                hashList.className = 'editorial-hash-list';
                hashEntries.forEach(({ file, hash }) => {
                    const li = document.createElement('li');
                    const truncated = hash.length > 16 ? hash.slice(0, 8) + '...' + hash.slice(-8) : hash;
                    li.innerHTML = `<span>${escapeHtml(file)}</span> ${escapeHtml(truncated)}`;
                    hashList.appendChild(li);
                });
                content.appendChild(hashList);
            }

            // Creation / modified dates
            const creationDate = manifest?._creation_date || manifest?._meta?.created;
            const modifiedDate = manifest?._last_modified || manifest?._meta?.modified;
            if (creationDate || modifiedDate) {
                const datesRow = document.createElement('div');
                datesRow.className = 'editorial-dates-row';
                if (creationDate) datesRow.appendChild(createTechDetail('Created', escapeHtml(String(creationDate))));
                if (modifiedDate) datesRow.appendChild(createTechDetail('Last Modified', escapeHtml(String(modifiedDate))));
                content.appendChild(datesRow);
            }

            contentWrapper.appendChild(section);
        }
    }

    // === Collapsible: Tags ===
    const tags = manifest?.tags || manifest?.project?.tags || [];
    if (tags.length > 0 && shouldShow('Tags')) {
        const { section, content } = createCollapsible('Tags', false);
        const tagsRow = document.createElement('div');
        tagsRow.className = 'editorial-info-tags';
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'editorial-tag-chip';
            chip.textContent = tag;
            tagsRow.appendChild(chip);
        });
        content.appendChild(tagsRow);
        contentWrapper.appendChild(section);
    }

    // === Footer ===
    const license = manifest?.license || manifest?.project?.license || manifest?.archival_record?.rights?.license ||
                    manifest?.archival_record?.rights?.statement || '';
    if (license) {
        const licenseEl = document.createElement('div');
        licenseEl.className = 'editorial-info-license';
        licenseEl.textContent = license;
        contentWrapper.appendChild(licenseEl);
    }

    panelInner.appendChild(contentWrapper);
    overlay.appendChild(panelInner);
    return overlay;
}

// ---- Main setup entry point ----

export function setup(manifest, deps) {
    const {
        Logger, escapeHtml,
        updateModelTextures, updateModelWireframe, updateModelMatcap, updateModelNormals,
        updateModelRoughness, updateModelMetalness, updateModelSpecularF0,
        sceneManager, state, annotationSystem, modelGroup,
        setDisplayMode, createDisplayModeDeps, triggerLazyLoad,
        showAnnotationPopup, hideAnnotationPopup, hideAnnotationLine,
        getCurrentPopupId, setCurrentPopupId,
        resetOrbitCenter
    } = deps;

    const log = Logger.getLogger('editorial-layout');
    log.info('Setting up editorial layout');

    const viewerContainer = document.getElementById('viewer-container') || document.body;

    // Set scene background from theme metadata, or fall back to CSS variable
    const themeMeta = (window.APP_CONFIG || {})._themeMeta;
    const sceneBg = (themeMeta && themeMeta.sceneBg) ||
        getComputedStyle(document.body).getPropertyValue('--kiosk-scene-bg').trim() ||
        '#1a1a2e';
    sceneManager.setBackgroundColor(sceneBg);

    // --- 1. Gold Spine ---
    const spine = document.createElement('div');
    spine.className = 'editorial-spine';
    viewerContainer.appendChild(spine);

    // --- 2. Title Block — title, gold rule, meta ---
    const titleBlock = document.createElement('div');
    titleBlock.className = 'editorial-title-block';

    const title = manifest?.title || manifest?.project?.title || manifest?.archival_record?.title || '';
    const location = manifest?.location || manifest?.provenance?.location || manifest?.archival_record?.creation?.place || '';
    const rawDate = manifest?.date || manifest?.provenance?.capture_date || manifest?.archival_record?.creation?.date || '';
    const date = formatDate(rawDate, 'medium') || rawDate;
    const metaParts = [location, date].filter(Boolean);

    titleBlock.innerHTML = `
        <h1>${escapeHtml(title)}</h1>
        <div class="editorial-title-rule"></div>
        ${metaParts.length > 0 ? `<span class="editorial-title-meta">${escapeHtml(metaParts.join(' \u00B7 '))}</span>` : ''}
    `;
    viewerContainer.appendChild(titleBlock);

    // Auto-fade behavior for title block
    setupAutoFade(titleBlock, null);

    // Logo src for ribbon
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    // --- 4. Bottom Ribbon ---
    const ribbon = document.createElement('div');
    ribbon.className = 'editorial-bottom-ribbon';

    // View modes
    const viewModes = document.createElement('div');
    viewModes.className = 'editorial-view-modes';

    const contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    const types = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Model' });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Splat' });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Point Cloud' });
    }
    if (types.length >= 2) {
        types.push({ mode: 'both', label: 'Both' });
    }

    types.forEach(({ mode, label }) => {
        const link = document.createElement('button');
        link.className = 'editorial-view-mode-link';
        link.dataset.mode = mode;
        link.textContent = label;
        if (state.displayMode === mode) link.classList.add('active');
        link.addEventListener('click', () => {
            state.displayMode = mode;
            setDisplayMode(mode, createDisplayModeDeps());
            triggerLazyLoad(mode);
            viewModes.querySelectorAll('.editorial-view-mode-link:not(.quality-toggle-btn)').forEach(l => {
                l.classList.toggle('active', l.dataset.mode === mode);
            });
        });
        viewModes.appendChild(link);
    });

    // Quality toggle (SD/HD) — inline with view modes if archive has proxies or splat (Spark 2.0 LOD budget)
    if (deps.hasAnyProxy || deps.hasSplat) {
        const qualitySep = document.createElement('span');
        qualitySep.className = 'editorial-view-mode-sep';
        qualitySep.textContent = '|';
        viewModes.appendChild(qualitySep);

        const sdBtn = document.createElement('button');
        sdBtn.className = 'editorial-view-mode-link quality-toggle-btn' + (deps.qualityResolved === 'sd' ? ' active' : '');
        sdBtn.dataset.tier = 'sd';
        sdBtn.textContent = 'SD';
        viewModes.appendChild(sdBtn);

        const hdBtn = document.createElement('button');
        hdBtn.className = 'editorial-view-mode-link quality-toggle-btn' + (deps.qualityResolved === 'hd' ? ' active' : '');
        hdBtn.dataset.tier = 'hd';
        hdBtn.textContent = 'HD';
        viewModes.appendChild(hdBtn);

        [sdBtn, hdBtn].forEach(btn => {
            btn.addEventListener('click', () => {
                if (deps.switchQualityTier) deps.switchQualityTier(btn.dataset.tier);
                [sdBtn, hdBtn].forEach(b => {
                    b.classList.toggle('active', b.dataset.tier === btn.dataset.tier);
                });
            });
        });
    }

    // Info link — last item in viewModes
    const infoSep = document.createElement('span');
    infoSep.className = 'editorial-view-mode-sep';
    infoSep.textContent = '|';
    viewModes.appendChild(infoSep);
    const detailsLink = document.createElement('button');
    detailsLink.className = 'editorial-view-mode-link editorial-details-link';
    detailsLink.textContent = 'Info';
    viewModes.appendChild(detailsLink);

    // Measure dropdown (like material view — self-contained, replaces global scale panel)
    let measureWrapper = null;
    if (deps.measurementSystem) {
        measureWrapper = document.createElement('div');
        measureWrapper.className = 'editorial-measure-wrapper';

        const measureBtn = document.createElement('button');
        measureBtn.className = 'editorial-marker-toggle editorial-measure-btn';
        measureBtn.title = 'Measure';
        measureBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M5.5 5.5L8 3"/><path d="M9.5 9.5L12 7"/><path d="M13.5 13.5L16 11"/><path d="M17.5 17.5L20 15"/></svg>';

        const measureDropdown = document.createElement('div');
        measureDropdown.className = 'editorial-measure-dropdown';

        // Scale row: 1 unit = [value] [unit]
        const scaleRow = document.createElement('div');
        scaleRow.className = 'editorial-measure-scale-row';

        const scaleLabel = document.createElement('span');
        scaleLabel.className = 'editorial-measure-scale-label';
        scaleLabel.textContent = '1 unit =';

        const scaleValue = document.createElement('input');
        scaleValue.type = 'number';
        scaleValue.value = '1';
        scaleValue.min = '0.0001';
        scaleValue.step = 'any';
        scaleValue.className = 'editorial-measure-scale-value';

        const scaleUnit = document.createElement('select');
        scaleUnit.className = 'editorial-measure-scale-unit';
        ['m', 'cm', 'mm', 'in', 'ft'].forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            if (u === 'in') opt.selected = true;
            scaleUnit.appendChild(opt);
        });

        scaleRow.appendChild(scaleLabel);
        scaleRow.appendChild(scaleValue);
        scaleRow.appendChild(scaleUnit);
        measureDropdown.appendChild(scaleRow);

        // Clear all button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'editorial-measure-clear';
        clearBtn.textContent = 'Clear all';
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deps.measurementSystem.clearAll();
        });
        measureDropdown.appendChild(clearBtn);

        // Wire scale inputs → setScale()
        const getVal = () => parseFloat(scaleValue.value) || 1;
        const getUnit = () => scaleUnit.value;
        scaleValue.addEventListener('input', (e) => {
            e.stopPropagation();
            deps.measurementSystem.setScale(getVal(), getUnit());
        });
        scaleUnit.addEventListener('change', (e) => {
            e.stopPropagation();
            deps.measurementSystem.setScale(getVal(), getUnit());
        });

        // Initialize with inches
        deps.measurementSystem.setScale(1, 'in');

        // Button toggles measure mode + dropdown; deactivation clears all measurements
        measureBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = !deps.measurementSystem.isActive;
            deps.measurementSystem.setMeasureMode(isActive);
            if (!isActive) deps.measurementSystem.clearAll();
            measureBtn.classList.toggle('active', isActive);
            measureDropdown.classList.toggle('open', isActive);
        });

        measureWrapper.appendChild(measureBtn);
        measureWrapper.appendChild(measureDropdown);
    }

    ribbon.appendChild(viewModes);

    // Separator after Info / before tools
    const infoToolsRule = document.createElement('div');
    infoToolsRule.className = 'editorial-ribbon-rule';
    ribbon.appendChild(infoToolsRule);

    // Right-side tools wrapper — keeps tools grouped and prevents viewModes overlap
    const toolsGroup = document.createElement('div');
    toolsGroup.className = 'editorial-ribbon-tools';

    // Annotation sequence chain + marker toggle
    const annotations = annotationSystem.getAnnotations();
    let markersVisible = true;
    let markerToggle = null;

    const setMarkersVisible = (visible) => {
        markersVisible = visible;
        const container = document.getElementById('annotation-markers');
        if (container) container.style.display = markersVisible ? '' : 'none';
        if (markerToggle) markerToggle.classList.toggle('off', !markersVisible);
    };

    if (annotations.length > 0) {
        const sequence = document.createElement('div');
        sequence.className = 'editorial-anno-sequence';

        annotations.forEach((anno, i) => {
            if (i > 0) {
                const dash = document.createElement('span');
                dash.className = 'editorial-anno-seq-dash';
                sequence.appendChild(dash);
            }

            const num = document.createElement('button');
            num.className = 'editorial-anno-seq-num';
            num.dataset.annoId = anno.id;
            num.textContent = String(i + 1).padStart(2, '0');
            num.addEventListener('click', () => {
                if (getCurrentPopupId() === anno.id) {
                    hideAnnotationPopup();
                    hideAnnotationLine();
                    setCurrentPopupId(null);
                    annotationSystem.selectedAnnotation = null;
                    document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                    sequence.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
                    return;
                }

                if (!markersVisible) setMarkersVisible(true);

                sequence.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
                num.classList.add('active');

                annotationSystem.goToAnnotation(anno.id);
                setCurrentPopupId(showAnnotationPopup(anno, state.imageAssets));
            });
            sequence.appendChild(num);
        });

        toolsGroup.appendChild(sequence);

        // Marker visibility toggle
        markerToggle = document.createElement('button');
        markerToggle.className = 'editorial-marker-toggle';
        markerToggle.title = 'Toggle annotation markers';
        markerToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
        markerToggle.addEventListener('click', () => {
            setMarkersVisible(!markersVisible);
            if (!markersVisible && getCurrentPopupId()) {
                hideAnnotationPopup();
                hideAnnotationLine();
                setCurrentPopupId(null);
                annotationSystem.selectedAnnotation = null;
                document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                sequence.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
            }
        });
        // Reset orbit center
        const orbitResetBtn = document.createElement('button');
        orbitResetBtn.className = 'editorial-marker-toggle';
        orbitResetBtn.title = 'Reset rotation center';
        orbitResetBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
        orbitResetBtn.addEventListener('click', () => { if (resetOrbitCenter) resetOrbitCenter(); });
        toolsGroup.appendChild(orbitResetBtn);

        toolsGroup.appendChild(markerToggle);
        if (measureWrapper) toolsGroup.appendChild(measureWrapper);
    } else {
        // No annotations — still show orbit reset and measure
        const orbitResetBtn = document.createElement('button');
        orbitResetBtn.className = 'editorial-marker-toggle';
        orbitResetBtn.title = 'Reset rotation center';
        orbitResetBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
        orbitResetBtn.addEventListener('click', () => { if (resetOrbitCenter) resetOrbitCenter(); });
        toolsGroup.appendChild(orbitResetBtn);
        if (measureWrapper) toolsGroup.appendChild(measureWrapper);
    }

    // Rule separator between annotation and visualization groups
    const vizRule = document.createElement('div');
    vizRule.className = 'editorial-ribbon-rule';
    toolsGroup.appendChild(vizRule);

    // Mesh visualization tools
    // Texture toggle
    const textureToggle = document.createElement('button');
    textureToggle.className = 'editorial-marker-toggle';
    textureToggle.title = 'Toggle textures';
    textureToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    let texturesVisible = true;
    textureToggle.addEventListener('click', () => {
        texturesVisible = !texturesVisible;
        updateModelTextures(modelGroup, texturesVisible);
        textureToggle.classList.toggle('off', !texturesVisible);
    });
    toolsGroup.appendChild(textureToggle);

    // Combined Material Views dropdown (wireframe, normals, PBR channels, matcap presets)
    const matcapPresets = ['clay', 'chrome', 'pearl', 'jade', 'copper'];
    const matcapLabels = ['Clay', 'Chrome', 'Pearl', 'Jade', 'Copper'];
    let activeView = null; // null or: 'wireframe','normals','roughness','metalness','specularF0','matcap:clay', etc.

    const materialWrapper = document.createElement('div');
    materialWrapper.className = 'editorial-matcap-wrapper';

    const materialBtn = document.createElement('button');
    materialBtn.className = 'editorial-marker-toggle';
    materialBtn.title = 'Material views';
    materialBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></svg>';

    const materialDropdown = document.createElement('div');
    materialDropdown.className = 'editorial-matcap-dropdown';

    const viewLabels = {
        wireframe: 'Wireframe', normals: 'Normals',
        roughness: 'Roughness', metalness: 'Metalness', specularF0: 'Specular F0'
    };

    const setMaterialView = (view) => {
        if (view === activeView) view = null;
        // Disable current
        if (activeView) {
            if (activeView === 'wireframe') updateModelWireframe(modelGroup, false);
            else if (activeView === 'normals') updateModelNormals(modelGroup, false);
            else if (activeView === 'roughness') updateModelRoughness(modelGroup, false);
            else if (activeView === 'metalness') updateModelMetalness(modelGroup, false);
            else if (activeView === 'specularF0') updateModelSpecularF0(modelGroup, false);
            else if (activeView.startsWith('matcap:')) updateModelMatcap(modelGroup, false);
        }
        activeView = view;
        // Enable new
        if (activeView) {
            if (activeView === 'wireframe') updateModelWireframe(modelGroup, true);
            else if (activeView === 'normals') updateModelNormals(modelGroup, true);
            else if (activeView === 'roughness') updateModelRoughness(modelGroup, true);
            else if (activeView === 'metalness') updateModelMetalness(modelGroup, true);
            else if (activeView === 'specularF0') updateModelSpecularF0(modelGroup, true);
            else if (activeView.startsWith('matcap:')) updateModelMatcap(modelGroup, true, activeView.split(':')[1]);
        }
        // Update button — highlight when a view is active, but never dim to .off
        materialBtn.classList.toggle('active', !!activeView);
        const label = activeView
            ? (viewLabels[activeView] || matcapLabels[matcapPresets.indexOf((activeView.split(':')[1]) || '')] || activeView)
            : null;
        materialBtn.title = label ? 'Material: ' + label : 'Material views';
        materialDropdown.querySelectorAll('.editorial-matcap-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === activeView);
        });
        materialDropdown.classList.remove('open');
    };

    const addMaterialItem = (label, viewKey) => {
        const item = document.createElement('button');
        item.className = 'editorial-matcap-item';
        item.dataset.view = viewKey;
        item.textContent = label;
        item.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView(viewKey); });
        materialDropdown.appendChild(item);
    };

    const addDivider = () => {
        const d = document.createElement('div');
        d.className = 'editorial-material-divider';
        materialDropdown.appendChild(d);
    };

    addMaterialItem('Wireframe', 'wireframe');
    addMaterialItem('Normals', 'normals');
    addMaterialItem('Roughness', 'roughness');
    addMaterialItem('Metalness', 'metalness');
    addMaterialItem('Specular F0', 'specularF0');
    addDivider();
    matcapPresets.forEach((style, i) => addMaterialItem(matcapLabels[i], 'matcap:' + style));
    addDivider();
    const offItem = document.createElement('button');
    offItem.className = 'editorial-matcap-item editorial-matcap-off';
    offItem.textContent = 'Off';
    offItem.addEventListener('click', (e) => { e.stopPropagation(); setMaterialView(null); });
    materialDropdown.appendChild(offItem);

    materialBtn.addEventListener('click', (e) => { e.stopPropagation(); materialDropdown.classList.toggle('open'); });
    document.addEventListener('click', () => { materialDropdown.classList.remove('open'); });

    materialWrapper.appendChild(materialBtn);
    materialWrapper.appendChild(materialDropdown);
    toolsGroup.appendChild(materialWrapper);

    // FOV — camera icon with popover (same pattern as material dropdown)
    const fovWrapper = document.createElement('div');
    fovWrapper.className = 'editorial-fov-wrapper';

    const fovBtn = document.createElement('button');
    fovBtn.className = 'editorial-marker-toggle';
    fovBtn.title = 'Field of view';
    fovBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

    const fovDropdown = document.createElement('div');
    fovDropdown.className = 'editorial-fov-dropdown';

    const fovLabel = document.createElement('span');
    fovLabel.className = 'editorial-fov-label';
    fovLabel.textContent = '60°';

    const fovSlider = document.createElement('input');
    fovSlider.type = 'range';
    fovSlider.min = '10';
    fovSlider.max = '120';
    fovSlider.step = '1';
    fovSlider.value = '60';
    fovSlider.className = 'editorial-fov-slider';

    fovSlider.addEventListener('input', () => {
        const fov = parseInt(fovSlider.value, 10);
        fovLabel.textContent = fov + '°';
        if (sceneManager && sceneManager.camera) {
            sceneManager.camera.fov = fov;
            sceneManager.camera.updateProjectionMatrix();
        }
    });

    fovDropdown.appendChild(fovLabel);
    fovDropdown.appendChild(fovSlider);

    fovBtn.addEventListener('click', (e) => { e.stopPropagation(); fovDropdown.classList.toggle('open'); });
    document.addEventListener('click', () => { fovDropdown.classList.remove('open'); });
    fovDropdown.addEventListener('click', (e) => { e.stopPropagation(); });

    fovWrapper.appendChild(fovBtn);
    fovWrapper.appendChild(fovDropdown);
    toolsGroup.appendChild(fovWrapper);

    // Fullscreen button — appended next to logo on far right
    let fsBtn = null;
    if (document.fullscreenEnabled) {
        fsBtn = document.createElement('button');
        fsBtn.className = 'editorial-marker-toggle editorial-fullscreen-btn';
        fsBtn.title = 'Toggle Fullscreen (F11)';
        fsBtn.innerHTML = `<svg class="icon-expand" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg><svg class="icon-compress" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line></svg>`;
        fsBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });
        document.addEventListener('fullscreenchange', () => {
            const isFs = !!document.fullscreenElement;
            const expand = fsBtn.querySelector('.icon-expand');
            const compress = fsBtn.querySelector('.icon-compress');
            if (expand) expand.style.display = isFs ? 'none' : '';
            if (compress) compress.style.display = isFs ? '' : 'none';
        });
    }

    ribbon.appendChild(toolsGroup);

    // Separator between tools and logo
    const toolsLogoRule = document.createElement('div');
    toolsLogoRule.className = 'editorial-ribbon-rule';
    ribbon.appendChild(toolsLogoRule);

    // Right group — logo + fullscreen, pushed far right
    const ribbonLogo = document.createElement('img');
    ribbonLogo.className = 'editorial-ribbon-logo';
    ribbonLogo.src = logoSrc;
    ribbonLogo.alt = '';
    ribbonLogo.draggable = false;
    ribbon.appendChild(ribbonLogo);
    if (fsBtn) {
        const logoFsRule = document.createElement('div');
        logoFsRule.className = 'editorial-ribbon-rule';
        ribbon.appendChild(logoFsRule);
        ribbon.appendChild(fsBtn);
    }
    viewerContainer.appendChild(ribbon);

    // --- 5. Info Panel (side panel) ---
    const overlay = createInfoOverlay(manifest, deps);
    viewerContainer.appendChild(overlay);

    // Wire details link to panel
    detailsLink.addEventListener('click', () => {
        const isOpen = overlay.classList.toggle('open');
        detailsLink.classList.toggle('active', isOpen);
    });

    // --- Image strip parallax on info panel scroll ---
    const panelContent = overlay.querySelector('.editorial-info-content');
    const stripImg = overlay.querySelector('.editorial-image-strip img');
    if (panelContent && stripImg) {
        panelContent.addEventListener('scroll', () => {
            const offset = Math.max(panelContent.scrollTop * -0.08, -20);
            stripImg.style.transform = `translateY(${offset}px)`;
        }, { passive: true });
    }

    // --- Staggered annotation marker entrance ---
    setTimeout(() => {
        const markers = document.querySelectorAll('.annotation-marker');
        markers.forEach((marker, i) => {
            marker.style.animation = `editorialMarkerFadeIn 0.4s ease-out ${0.15 + i * 0.12}s both`;
        });
    }, 50);

    // Close panel on ESC; 'm' toggle handled by exported onKeyboardShortcut()
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (overlay.classList.contains('open')) {
            overlay.classList.remove('open');
            detailsLink.classList.remove('active');
        }
        // Check dropdown open state — not isActive, since kiosk handler may have already set it false
        const measureDropdown = document.querySelector('.editorial-measure-dropdown');
        if (measureDropdown?.classList.contains('open')) {
            measureDropdown.classList.remove('open');
            const measureBtn = document.querySelector('.editorial-measure-btn');
            if (measureBtn) measureBtn.classList.remove('active');
            if (deps.measurementSystem) {
                deps.measurementSystem.setMeasureMode(false);
                deps.measurementSystem.clearAll();
            }
        }
    });

    log.info('Editorial layout setup complete');
}

// ---- Loading screen customization ----

/**
 * Replace the default loading overlay content with editorial-styled DOM.
 * Preserves element IDs so showLoading/updateProgress/hideLoading still work.
 */
function initLoadingScreen(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-loading-center">
            <div id="loading-brand" class="hidden">
                <img id="loading-thumbnail" alt="" />
                <div class="editorial-loading-meta">
                    <div class="editorial-loading-eyebrow">Loading</div>
                    <h2 id="loading-title"></h2>
                    <div class="editorial-loading-title-bar"></div>
                    <p id="loading-content-types"></p>
                </div>
            </div>
            <div class="loading-spinner"></div>
            <p id="loading-text">Loading...</p>
        </div>
        <div class="editorial-loading-bottom">
            <div id="loading-progress-container" class="hidden">
                <div id="loading-progress-bar"></div>
            </div>
            <p id="loading-progress-text" class="hidden">0%</p>
        </div>
    `;
}

// ---- Click gate customization ----

/**
 * Replace the default click gate content with editorial-styled DOM.
 * Preserves element IDs so showClickGate population still works.
 */
function initClickGate(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-gate-backdrop">
            <img id="kiosk-gate-poster" alt="" />
            <div class="editorial-gate-overlay"></div>
        </div>
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-gate-content">
            <button id="kiosk-gate-play" type="button" aria-label="Load 3D viewer">
                <svg viewBox="0 0 24 24" width="40" height="40">
                    <polygon points="6,3 20,12 6,21" />
                </svg>
            </button>
        </div>
        <div class="editorial-gate-info">
            <h2 id="kiosk-gate-title"></h2>
            <div class="editorial-loading-title-bar"></div>
            <p id="kiosk-gate-types"></p>
        </div>
    `;
}

// ---- File picker customization ----

/**
 * Replace the default file picker content with editorial-styled DOM.
 * Preserves element IDs so setupFilePicker() event wiring still works.
 */
function initFilePicker(container, deps) {
    const logoSrc = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';

    container.innerHTML = `
        <div class="editorial-loading-spine"></div>
        <div class="editorial-loading-logo">
            <img src="${logoSrc}" alt="" draggable="false" />
        </div>
        <div class="editorial-loading-center kiosk-picker-box" id="kiosk-drop-zone">
            <div class="editorial-loading-eyebrow">Open File</div>
            <h1 class="editorial-picker-title">Vitrine3D</h1>
            <div class="editorial-loading-title-bar"></div>
            <p class="kiosk-picker-formats">
                Scans, models, point clouds, and archives
            </p>
            <button id="kiosk-picker-btn" type="button">Browse Files</button>
            <p class="kiosk-picker-prompt">or drag and drop here</p>
        </div>
        <div class="editorial-loading-bottom">
            <div class="editorial-picker-progress-shell"></div>
        </div>
        <input type="file" id="kiosk-picker-input" accept=".a3z,.a3d,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">
    `;
}

// ---- Layout module hooks (called by kiosk-main.ts) ----

function onAnnotationSelect(annotationId) {
    document.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
    const el = document.querySelector(`.editorial-anno-seq-num[data-anno-id="${annotationId}"]`);
    if (el) el.classList.add('active');
}

function onAnnotationDeselect() {
    document.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
}

function onViewModeChange(mode) {
    document.querySelectorAll('.editorial-view-mode-link').forEach(link => {
        link.classList.toggle('active', link.dataset.mode === mode);
    });
}

function onKeyboardShortcut(key) {
    if (key === 'm') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel) {
            const isOpen = panel.classList.toggle('open');
            if (btn) btn.classList.toggle('active', isOpen);
        }
        return true;
    }
    if (key === 'escape') {
        const panel = document.querySelector('.editorial-info-overlay');
        const btn = document.querySelector('.editorial-details-link');
        if (panel && panel.classList.contains('open')) {
            panel.classList.remove('open');
            if (btn) btn.classList.remove('active');
            return true;
        }
    }
    return false;
}

// ---- Self-register for offline kiosk discovery ----
if (!window.__KIOSK_LAYOUTS__) window.__KIOSK_LAYOUTS__ = {};
window.__KIOSK_LAYOUTS__['editorial'] = {
    setup, initLoadingScreen, initClickGate, initFilePicker,
    onAnnotationSelect, onAnnotationDeselect, onViewModeChange, onKeyboardShortcut,
    hasOwnInfoPanel: true,
    hasOwnQualityToggle: true
};
