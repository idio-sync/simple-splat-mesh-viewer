/**
 * Metadata completeness profile system.
 * Defines three tiers — Basic, Standard, Archival — that control
 * which metadata fields are visible in the editor, kiosk, and editorial theme.
 */

export type MetadataProfile = 'basic' | 'standard' | 'archival';

export const PROFILE_ORDER: Record<MetadataProfile, number> = {
    basic: 0,
    standard: 1,
    archival: 2,
};

/** Returns true if fieldTier is at or below the activeProfile */
export function isTierVisible(fieldTier: MetadataProfile, activeProfile: MetadataProfile): boolean {
    return PROFILE_ORDER[fieldTier] <= PROFILE_ORDER[activeProfile];
}

/** Maps each edit tab name (from #edit-category-select option values) to its minimum profile tier */
export const TAB_TIERS: Record<string, MetadataProfile> = {
    project:      'basic',
    provenance:   'basic',     // tab visible at basic; individual fields gated within
    quality:      'standard',
    assets:       'standard',
    archival:     'archival',
    material:     'archival',
    preservation: 'archival',
    integrity:    'archival',
    viewer:       'basic',
};

/** Maps kiosk detail section titles (from createDetailSection() in kiosk-main.ts) to tiers */
export const KIOSK_SECTION_TIERS: Record<string, MetadataProfile> = {
    'Quality & Accuracy':   'standard',
    'Processing Details':   'standard',
    'Data Assets':          'standard',
    'Relationships':        'standard',
    'Version History':      'standard',
    'Custom Fields':        'standard',
    'Archival Record':      'archival',
    'Material Properties':  'archival',
    'Preservation':         'archival',
    'Integrity':            'archival',
};

/** Maps editorial theme section titles (from addSection() in layout.js) to tiers */
export const EDITORIAL_SECTION_TIERS: Record<string, MetadataProfile> = {
    'Capture':          'basic',
    'Quality':          'standard',
    'Processing':       'standard',
    'Data Assets':      'standard',
    'Relationships':    'standard',
    'Archival Record':  'archival',
    'Integrity':        'archival',
};

/**
 * User-fillable metadata field IDs mapped to their minimum profile tier.
 * Used for completeness scoring — only fields at or below the active profile are counted.
 * Excludes auto-populated stats (splat count, mesh polys, etc.) and read-only display fields.
 */
export const COMPLETENESS_FIELDS: Record<string, MetadataProfile> = {
    // Project tab (basic)
    'meta-title':           'basic',
    'meta-description':     'basic',
    'meta-tags':            'basic',
    'meta-license':         'basic',

    // Provenance tab — basic fields
    'meta-capture-date':    'basic',
    'meta-capture-device':  'basic',
    'meta-operator':        'basic',
    'meta-location':        'basic',

    // Provenance tab — standard fields
    'meta-device-serial':       'standard',
    'meta-operator-orcid':      'standard',
    'meta-processing-notes':    'standard',
    'meta-conventions':         'standard',

    // Quality tab (standard)
    'meta-quality-tier':            'standard',
    'meta-quality-accuracy':        'standard',
    'meta-quality-res-value':       'standard',
    'meta-quality-scale-verify':    'standard',

    // Assets tab (standard)
    'meta-splat-created-by':        'standard',
    'meta-mesh-created-by':         'standard',
    'meta-pointcloud-created-by':   'standard',

    // Archival tab (archival)
    'meta-archival-title':          'archival',
    'meta-archival-creator':        'archival',
    'meta-archival-date-created':   'archival',
    'meta-archival-medium':         'archival',
    'meta-archival-provenance':     'archival',
    'meta-archival-copyright':      'archival',
    'meta-coverage-location':       'archival',
    'meta-coverage-lat':            'archival',
    'meta-coverage-lon':            'archival',
    'meta-archival-condition':      'archival',
    'meta-archival-credit':         'archival',
    'meta-archival-context-desc':   'archival',

    // Material tab (archival)
    'meta-material-workflow':       'archival',
    'meta-material-colorspace':     'archival',

    // Preservation tab (archival)
    'meta-pres-render-req':         'archival',
};

/**
 * Critical fields per tier — these trigger export warnings when empty.
 * Maps field IDs to human-readable labels.
 */
export const CRITICAL_FIELDS: Record<MetadataProfile, Record<string, string>> = {
    basic: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
        'meta-description': 'Description',
    },
    standard: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
        'meta-description': 'Description',
        'meta-capture-device': 'Capture Device',
        'meta-quality-tier': 'Quality Tier',
        'meta-location': 'Scan Location',
    },
    archival: {
        'meta-title': 'Title',
        'meta-operator': 'Scan Operator',
        'meta-capture-date': 'Capture Date',
        'meta-description': 'Description',
        'meta-capture-device': 'Capture Device',
        'meta-quality-tier': 'Quality Tier',
        'meta-location': 'Scan Location',
        'meta-archival-title': 'Catalog Title',
        'meta-archival-copyright': 'Original Object Copyright',
        'meta-coverage-location': 'Subject Location',
    },
};

/**
 * Check which critical fields are empty for the given profile.
 * Returns array of { id, label } for missing fields.
 */
export function getMissingCriticalFields(profile: MetadataProfile): Array<{ id: string; label: string }> {
    const critical = CRITICAL_FIELDS[profile];
    const missing: Array<{ id: string; label: string }> = [];
    for (const [id, label] of Object.entries(critical)) {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        if (!el) continue;
        const val = el.value?.trim() ?? '';
        if (!val || (el instanceof HTMLSelectElement && (val === '' || val === 'Not specified'))) {
            missing.push({ id, label });
        }
    }
    return missing;
}

/** PRONOM format registry — maps file extensions to PUIDs and human-readable names. */
export const PRONOM_REGISTRY: Record<string, { puid: string; name: string }> = {
    'glb':    { puid: 'fmt/861', name: 'glTF Binary' },
    'gltf':   { puid: 'fmt/860', name: 'glTF' },
    'obj':    { puid: 'fmt/935', name: 'Wavefront OBJ' },
    'ply':    { puid: 'fmt/831', name: 'Stanford PLY' },
    'e57':    { puid: 'fmt/643', name: 'ASTM E57' },
    'stl':    { puid: 'fmt/865', name: 'STL (Stereolithography)' },
    'splat':  { puid: '', name: 'Gaussian Splat' },
    'ksplat': { puid: '', name: 'Gaussian Splat (compressed)' },
    'spz':    { puid: '', name: 'Gaussian Splat (compressed)' },
};

/**
 * Get all field IDs that should count toward completeness for a given profile.
 */
export function getFieldsForProfile(profile: MetadataProfile): string[] {
    return Object.entries(COMPLETENESS_FIELDS)
        .filter(([, tier]) => isTierVisible(tier, profile))
        .map(([id]) => id);
}

/**
 * Count filled vs total user-fillable fields for a given profile.
 * Reads DOM values directly.
 */
export function computeCompleteness(profile: MetadataProfile): { filled: number; total: number } {
    const fields = getFieldsForProfile(profile);
    let filled = 0;
    for (const id of fields) {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
        if (!el) continue;
        const val = el.value?.trim() ?? '';
        // For selects, skip default/empty options
        if (el instanceof HTMLSelectElement) {
            if (val && val !== 'Not specified' && val !== '') filled++;
        } else {
            if (val) filled++;
        }
    }
    return { filled, total: fields.length };
}
