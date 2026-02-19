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

// ---- Info overlay (magazine-spread details panel) ----

function createInfoOverlay(manifest, deps) {
    const { escapeHtml, parseMarkdown, resolveAssetRefs, state, annotationSystem, modelGroup } = deps;

    const overlay = document.createElement('div');
    overlay.className = 'editorial-info-overlay';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'editorial-info-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        overlay.classList.remove('open');
        const detailsBtn = document.querySelector('.editorial-details-link');
        if (detailsBtn) detailsBtn.classList.remove('active');
    });
    overlay.appendChild(closeBtn);

    // Two-column spread
    const spread = document.createElement('div');
    spread.className = 'editorial-info-spread';

    // === Left Column — title & narrative ===
    const colLeft = document.createElement('div');
    colLeft.className = 'editorial-info-col-left';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'editorial-info-eyebrow';
    eyebrow.textContent = 'Details';
    colLeft.appendChild(eyebrow);

    const title = manifest?.title || manifest?.project?.title || manifest?.archival_record?.title || '';
    if (title) {
        const titleEl = document.createElement('h2');
        titleEl.className = 'editorial-info-title';
        titleEl.textContent = title;
        colLeft.appendChild(titleEl);

        const titleBar = document.createElement('div');
        titleBar.className = 'editorial-info-title-bar';
        colLeft.appendChild(titleBar);
    }

    // Model stats — show geometry info when a mesh is loaded
    if (modelGroup && modelGroup.children.length > 0) {
        let vertexCount = 0, faceCount = 0, meshCount = 0, materialSet = new Set();
        let textureSet = new Set(), maxTexRes = 0;
        modelGroup.traverse(child => {
            if (child.isMesh && child.geometry) {
                meshCount++;
                const geo = child.geometry;
                if (geo.attributes.position) vertexCount += geo.attributes.position.count;
                if (geo.index) faceCount += geo.index.count / 3;
                else if (geo.attributes.position) faceCount += geo.attributes.position.count / 3;
                // Count unique materials and textures
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => {
                    if (m) {
                        materialSet.add(m);
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
        faceCount = Math.round(faceCount);
        if (vertexCount > 0) {
            const parts = [];
            parts.push(`${vertexCount.toLocaleString()} vertices`);
            parts.push(`${faceCount.toLocaleString()} faces`);
            if (meshCount > 1) parts.push(`${meshCount} meshes`);
            if (materialSet.size > 1) parts.push(`${materialSet.size} materials`);
            if (textureSet.size > 0) parts.push(`${textureSet.size} textures @ ${maxTexRes}²`);

            const statsEl = document.createElement('div');
            statsEl.className = 'editorial-info-model-stats';
            statsEl.textContent = parts.join(' · ');
            colLeft.appendChild(statsEl);
        }
    }

    const desc = manifest?.description || manifest?.project?.description || '';
    if (desc) {
        const descEl = document.createElement('div');
        descEl.className = 'editorial-info-description';
        descEl.innerHTML = parseMarkdown(resolveAssetRefs(desc, state.imageAssets || {}));
        colLeft.appendChild(descEl);
    }

    const tags = manifest?.tags || manifest?.project?.tags || [];
    if (tags.length > 0) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'editorial-info-tags';
        tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'editorial-tag-chip';
            chip.textContent = tag;
            tagsRow.appendChild(chip);
        });
        colLeft.appendChild(tagsRow);
    }

    const license = manifest?.license || manifest?.project?.license || manifest?.archival_record?.rights?.license ||
                    manifest?.archival_record?.rights?.statement || '';
    if (license) {
        const licenseEl = document.createElement('div');
        licenseEl.className = 'editorial-info-license';
        licenseEl.textContent = license;
        colLeft.appendChild(licenseEl);
    }

    spread.appendChild(colLeft);

    const rule = document.createElement('div');
    rule.className = 'editorial-info-col-rule';
    spread.appendChild(rule);

    // === Right Column — data & metrics ===
    const colRight = document.createElement('div');
    colRight.className = 'editorial-info-col-right';

    const addSection = (headerText, details) => {
        if (details.length === 0) return;
        const header = document.createElement('div');
        header.className = 'editorial-info-section-header';
        header.textContent = headerText;
        colRight.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'editorial-info-detail-grid';
        details.forEach(({ label, value }) => {
            const detail = document.createElement('div');
            detail.className = 'editorial-info-detail';
            detail.innerHTML = `<span class="editorial-info-detail-label">${escapeHtml(label)}</span><span class="editorial-info-detail-value">${escapeHtml(String(value))}</span>`;
            grid.appendChild(detail);
        });
        colRight.appendChild(grid);
    };

    const metadataProfile = deps.metadataProfile || 'archival';
    const shouldShow = (title) => {
        const tiers = deps.EDITORIAL_SECTION_TIERS;
        const tier = tiers?.[title];
        if (!tier || !deps.isTierVisible) return true;
        return deps.isTierVisible(tier, metadataProfile);
    };

    // 1. Capture details
    const captureDetails = [];
    const captureDate = manifest?.date || manifest?.provenance?.capture_date;
    if (captureDate) captureDetails.push({ label: 'Date', value: formatDate(captureDate) || captureDate });
    if (manifest?.provenance?.capture_device) captureDetails.push({ label: 'Device', value: manifest.provenance.capture_device });
    if (manifest?.provenance?.device_serial) captureDetails.push({ label: 'Serial', value: manifest.provenance.device_serial });
    const operator = manifest?.creator || manifest?.provenance?.operator;
    if (operator) captureDetails.push({ label: 'Operator', value: operator });
    const captureLocation = manifest?.location || manifest?.provenance?.location;
    if (captureLocation) captureDetails.push({ label: 'Location', value: captureLocation });
    if (manifest?.provenance?.operator_orcid) captureDetails.push({ label: 'ORCID', value: manifest.provenance.operator_orcid });
    if (shouldShow('Capture')) addSection('Capture', captureDetails);

    // 2. Quality & accuracy
    const qm = manifest?.quality_metrics;
    const qualityDetails = [];
    if (qm) {
        if (qm.tier) qualityDetails.push({ label: 'Tier', value: `Tier ${qm.tier}` });
        if (qm.accuracy_grade) qualityDetails.push({ label: 'Accuracy', value: `Grade ${qm.accuracy_grade}` });
        if (qm.capture_resolution?.value != null) {
            const cr = qm.capture_resolution;
            qualityDetails.push({ label: 'Resolution', value: `${cr.value}${cr.unit || ''} GSD` });
        }
        if (qm.alignment_error?.value != null) {
            const ae = qm.alignment_error;
            qualityDetails.push({ label: 'Alignment', value: `${ae.value}${ae.unit || ''} RMSE` });
        }
        if (qm.scale_verification) qualityDetails.push({ label: 'Scale Check', value: qm.scale_verification });
        if (hasValue(qm.data_quality)) {
            Object.keys(qm.data_quality).forEach(k => {
                qualityDetails.push({ label: k.replace(/_/g, ' '), value: qm.data_quality[k] });
            });
        }
    }
    if (shouldShow('Quality')) addSection('Quality', qualityDetails);

    // 3. Processing
    const prov = manifest?.provenance;
    const processDetails = [];
    if (prov) {
        if (Array.isArray(prov.processing_software)) {
            prov.processing_software.forEach(sw => {
                const val = typeof sw === 'object' ? `${sw.name || ''} ${sw.version || ''}`.trim() : sw;
                if (val) processDetails.push({ label: 'Software', value: val });
            });
        }
        if (prov.processing_notes) processDetails.push({ label: 'Notes', value: prov.processing_notes });
        if (prov.convention_hints?.length) processDetails.push({ label: 'Conventions', value: Array.isArray(prov.convention_hints) ? prov.convention_hints.join(', ') : prov.convention_hints });
    }
    if (shouldShow('Processing')) addSection('Processing', processDetails);

    // 4. Archival record
    const ar = manifest?.archival_record;
    const archivalDetails = [];
    if (ar) {
        if (ar.standard) archivalDetails.push({ label: 'Standard', value: ar.standard });
        if (hasValue(ar.ids)) {
            Object.keys(ar.ids).forEach(k => archivalDetails.push({ label: `ID (${k})`, value: ar.ids[k] }));
        }
        if (hasValue(ar.physical_description)) {
            Object.keys(ar.physical_description).forEach(k => {
                archivalDetails.push({ label: k.replace(/_/g, ' '), value: ar.physical_description[k] });
            });
        }
        if (ar.provenance) archivalDetails.push({ label: 'Provenance', value: ar.provenance });
        if (ar.rights?.holder) archivalDetails.push({ label: 'Rights Holder', value: ar.rights.holder });
        if (hasValue(ar.context)) {
            Object.keys(ar.context).forEach(k => {
                archivalDetails.push({ label: k.replace(/_/g, ' '), value: ar.context[k] });
            });
        }
        if (hasValue(ar.coverage?.spatial)) {
            Object.keys(ar.coverage.spatial).forEach(k => {
                archivalDetails.push({ label: `Spatial ${k}`, value: ar.coverage.spatial[k] });
            });
        }
    }
    if (shouldShow('Archival Record')) addSection('Archival Record', archivalDetails);

    // 5. Data assets
    const entries = manifest?.data_entries;
    const assetDetails = [];
    if (Array.isArray(entries)) {
        entries.forEach(entry => {
            const name = entry.file_name || entry.filename;
            assetDetails.push({ label: entry.role || 'File', value: name });
        });
    }
    if (shouldShow('Data Assets')) addSection('Data Assets', assetDetails);

    // 6. Relationships
    const rel = manifest?.relationships;
    const relDetails = [];
    if (hasValue(rel)) {
        if (rel.part_of) relDetails.push({ label: 'Part Of', value: rel.part_of });
        if (rel.derived_from) relDetails.push({ label: 'Derived From', value: rel.derived_from });
        if (rel.replaces) relDetails.push({ label: 'Replaces', value: rel.replaces });
    }
    if (shouldShow('Relationships')) addSection('Relationships', relDetails);

    // 7. Integrity
    const integ = manifest?.integrity;
    const integDetails = [];
    if (hasValue(integ)) {
        if (integ.algorithm) integDetails.push({ label: 'Algorithm', value: integ.algorithm });
        if (integ.manifest_hash) integDetails.push({ label: 'Hash', value: integ.manifest_hash });
    }
    if (shouldShow('Integrity')) addSection('Integrity', integDetails);

    // Stats row
    const contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    if (contentInfo) {
        const statsRow = document.createElement('div');
        statsRow.className = 'editorial-info-stats-row';

        const statItems = [];
        if (contentInfo.hasSplat) statItems.push({ num: '1', label: 'Splat' });
        if (contentInfo.hasMesh) statItems.push({ num: '1', label: 'Mesh' });
        if (contentInfo.hasPointcloud) statItems.push({ num: '1', label: 'Point Cloud' });
        const annoCount = annotationSystem.getAnnotations().length;
        if (annoCount > 0) statItems.push({ num: String(annoCount), label: 'Annotations' });

        statItems.forEach(({ num, label }) => {
            const stat = document.createElement('div');
            stat.className = 'editorial-info-stat';
            stat.innerHTML = `<div class="editorial-info-stat-number">${escapeHtml(num)}</div><div class="editorial-info-stat-label">${escapeHtml(label)}</div>`;
            statsRow.appendChild(stat);
        });

        colRight.appendChild(statsRow);
    }

    spread.appendChild(colRight);
    overlay.appendChild(spread);
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
        getCurrentPopupId, setCurrentPopupId
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

    // --- 2. Title Block ---
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

    // --- 3. Corner Logo ---
    const cornerLogo = document.createElement('div');
    cornerLogo.className = 'editorial-corner-logo';
    const logoImg = document.createElement('img');
    logoImg.className = 'editorial-corner-logo-img';
    logoImg.src = (deps.themeAssets && deps.themeAssets['logo.png'])
        || (deps.themeBaseUrl || 'themes/editorial/') + 'logo.png';
    logoImg.alt = '';
    logoImg.draggable = false;
    cornerLogo.appendChild(logoImg);
    viewerContainer.appendChild(cornerLogo);

    // Auto-fade behavior for title block and corner logo
    setupAutoFade(titleBlock, cornerLogo);

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
            viewModes.querySelectorAll('.editorial-view-mode-link').forEach(l => {
                l.classList.toggle('active', l.dataset.mode === mode);
            });
        });
        viewModes.appendChild(link);
    });

    // Quality toggle (SD/HD) — inline with view modes if archive has proxies
    if (deps.hasAnyProxy) {
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

    // Details link
    const detailsSep = document.createElement('span');
    detailsSep.className = 'editorial-view-mode-sep';
    detailsSep.textContent = '|';
    viewModes.appendChild(detailsSep);

    const detailsLink = document.createElement('button');
    detailsLink.className = 'editorial-view-mode-link editorial-details-link';
    detailsLink.textContent = 'Details';
    viewModes.appendChild(detailsLink);

    // Measure dropdown (like material view — self-contained, replaces global scale panel)
    if (deps.measurementSystem) {
        const measureSep = document.createElement('span');
        measureSep.className = 'editorial-view-mode-sep';
        measureSep.textContent = '|';
        viewModes.appendChild(measureSep);

        const measureWrapper = document.createElement('div');
        measureWrapper.className = 'editorial-measure-wrapper';

        const measureBtn = document.createElement('button');
        measureBtn.className = 'editorial-view-mode-link editorial-measure-btn';
        measureBtn.textContent = 'Measure';

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
        viewModes.appendChild(measureWrapper);
    }

    ribbon.appendChild(viewModes);

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
        const ruleEl = document.createElement('div');
        ruleEl.className = 'editorial-ribbon-rule';
        ribbon.appendChild(ruleEl);

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

        ribbon.appendChild(sequence);

        // Marker visibility toggle
        markerToggle = document.createElement('button');
        markerToggle.className = 'editorial-marker-toggle';
        markerToggle.style.marginLeft = 'auto';
        markerToggle.title = 'Toggle annotation markers';
        markerToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
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
        ribbon.appendChild(markerToggle);
    }

    // Mesh visualization tools
    // Texture toggle
    const textureToggle = document.createElement('button');
    textureToggle.className = 'editorial-marker-toggle';
    if (annotations.length === 0) textureToggle.style.marginLeft = 'auto';
    textureToggle.title = 'Toggle textures';
    textureToggle.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    let texturesVisible = true;
    textureToggle.addEventListener('click', () => {
        texturesVisible = !texturesVisible;
        updateModelTextures(modelGroup, texturesVisible);
        textureToggle.classList.toggle('off', !texturesVisible);
    });
    ribbon.appendChild(textureToggle);

    // Combined Material Views dropdown (wireframe, normals, PBR channels, matcap presets)
    const matcapPresets = ['clay', 'chrome', 'pearl', 'jade', 'copper'];
    const matcapLabels = ['Clay', 'Chrome', 'Pearl', 'Jade', 'Copper'];
    let activeView = null; // null or: 'wireframe','normals','roughness','metalness','specularF0','matcap:clay', etc.

    const materialWrapper = document.createElement('div');
    materialWrapper.className = 'editorial-matcap-wrapper';

    const materialBtn = document.createElement('button');
    materialBtn.className = 'editorial-marker-toggle off';
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
        // Update button
        materialBtn.classList.toggle('off', !activeView);
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
    ribbon.appendChild(materialWrapper);

    // FOV slider — compact inline control
    const fovWrapper = document.createElement('div');
    fovWrapper.className = 'editorial-fov-wrapper';

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
    fovSlider.title = 'Field of view';

    fovSlider.addEventListener('input', () => {
        const fov = parseInt(fovSlider.value, 10);
        fovLabel.textContent = fov + '°';
        if (sceneManager && sceneManager.camera) {
            sceneManager.camera.fov = fov;
            sceneManager.camera.updateProjectionMatrix();
        }
    });

    fovWrapper.appendChild(fovSlider);
    fovWrapper.appendChild(fovLabel);
    ribbon.appendChild(fovWrapper);

    // Fullscreen button — far right of ribbon
    if (document.fullscreenEnabled) {
        const fsBtn = document.createElement('button');
        fsBtn.className = 'editorial-marker-toggle editorial-fullscreen-btn';
        fsBtn.title = 'Toggle Fullscreen (F11)';
        fsBtn.style.marginLeft = '8px';
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
        ribbon.appendChild(fsBtn);
    }

    viewerContainer.appendChild(ribbon);

    // --- 5. Info Overlay ---
    const overlay = createInfoOverlay(manifest, deps);
    viewerContainer.appendChild(overlay);

    // Wire details link to overlay
    detailsLink.addEventListener('click', () => {
        const isOpen = overlay.classList.toggle('open');
        detailsLink.classList.toggle('active', isOpen);
    });

    // Close overlay when clicking the backdrop
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('open');
            detailsLink.classList.remove('active');
        }
    });

    // Close overlay or exit measure mode on ESC key
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
        <div class="editorial-picker-center">
            <div class="editorial-picker-eyebrow">Open File</div>
            <h1 class="editorial-picker-title">Vitrine3D</h1>
            <div class="editorial-loading-title-bar"></div>
            <p class="editorial-picker-desc">Open a 3D file or archive to view its content.</p>
            <div class="kiosk-picker-box" id="kiosk-drop-zone">
                <p>Select a <strong>3D file</strong> or <strong>archive</strong></p>
                <button id="kiosk-picker-btn" type="button">Select File</button>
                <p class="kiosk-picker-hint">or drag and drop it here</p>
                <p class="kiosk-picker-formats">
                    Archives (.a3d, .a3z) &middot; Models (.glb, .gltf, .obj, .stl)<br>
                    Splats (.ply, .splat, .ksplat, .spz, .sog) &middot; Point Clouds (.e57)
                </p>
            </div>
            <input type="file" id="kiosk-picker-input" accept=".a3z,.a3d,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">
        </div>
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
