/**
 * Quality Tier Module
 *
 * Device capability detection and quality-tier helpers for SD/HD
 * asset selection. Used by both main.js and kiosk-main.js.
 */

import { QUALITY_TIER, DEVICE_THRESHOLDS } from './constants.js';
import { Logger } from './utilities.js';

const log = Logger.getLogger('quality-tier');

// Extend Navigator interface for Chrome-only deviceMemory API
declare global {
  interface Navigator {
    deviceMemory?: number;
  }
}

/**
 * Detect device capability tier based on hardware signals.
 * Returns QUALITY_TIER.SD for low-end devices, QUALITY_TIER.HD for capable ones.
 *
 * Scoring: 5 heuristics, each worth 1 point. Score >= 3 = HD.
 *
 * @param gl - GL context for GPU queries
 * @returns QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function detectDeviceTier(gl?: WebGLRenderingContext | WebGL2RenderingContext): string {
    let score = 0;

    // 1. Device memory (Chrome/Edge only; absent = assume capable)
    const mem = navigator.deviceMemory;
    if (mem === undefined || mem >= DEVICE_THRESHOLDS.LOW_MEMORY_GB) {
        score++;
    }

    // 2. CPU core count
    const cores = navigator.hardwareConcurrency;
    if (cores === undefined || cores >= DEVICE_THRESHOLDS.LOW_CORES) {
        score++;
    }

    // 3. Screen width (proxy for mobile vs desktop)
    if (screen.width >= DEVICE_THRESHOLDS.MOBILE_WIDTH_PX) {
        score++;
    }

    // 4. GPU max texture size (requires GL context)
    if (gl) {
        try {
            const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (maxTex >= DEVICE_THRESHOLDS.LOW_MAX_TEXTURE) {
                score++;
            }
        } catch {
            // If we can't query, assume capable
            score++;
        }
    } else {
        score++; // No GL context available, assume capable
    }

    // 5. User agent mobile check
    const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
        score++;
    }

    const tier = score >= 3 ? QUALITY_TIER.HD : QUALITY_TIER.SD;
    log.info(`Device tier detected: ${tier} (score ${score}/5)`);
    return tier;
}

/**
 * Resolve a quality tier value. AUTO is resolved via device detection;
 * SD and HD are returned as-is.
 *
 * @param tier - QUALITY_TIER.AUTO, .SD, or .HD
 * @param gl - GL context for device detection
 * @returns QUALITY_TIER.SD or QUALITY_TIER.HD
 */
export function resolveQualityTier(tier: string, gl?: WebGLRenderingContext | WebGL2RenderingContext): string {
    if (tier === QUALITY_TIER.SD || tier === QUALITY_TIER.HD) {
        return tier;
    }
    return detectDeviceTier(gl);
}

/**
 * Check if archive content has any proxies (mesh or splat).
 * @param contentInfo - from archiveLoader.getContentInfo()
 * @returns true if mesh or scene proxy exists
 */
export function hasAnyProxy(contentInfo: { hasMeshProxy?: boolean; hasSceneProxy?: boolean }): boolean {
    return !!(contentInfo.hasMeshProxy || contentInfo.hasSceneProxy);
}

/**
 * Default LOD splat budgets by quality tier.
 * Controls SparkRenderer.lodSplatCount — the hard cap on splats rendered per frame.
 * Can be overridden via Docker env vars LOD_BUDGET_SD / LOD_BUDGET_HD.
 */
const DEFAULT_LOD_BUDGETS: Record<string, number> = {
    [QUALITY_TIER.SD]: 500_000,
    [QUALITY_TIER.HD]: 3_000_000,
};

/** Resolve LOD budgets: APP_CONFIG overrides take priority over defaults. */
function resolveLodBudgets(): Record<string, number> {
    const cfg = (window as any).APP_CONFIG;
    return {
        [QUALITY_TIER.SD]: (cfg?.lodBudgetSd > 0) ? cfg.lodBudgetSd : DEFAULT_LOD_BUDGETS[QUALITY_TIER.SD],
        [QUALITY_TIER.HD]: (cfg?.lodBudgetHd > 0) ? cfg.lodBudgetHd : DEFAULT_LOD_BUDGETS[QUALITY_TIER.HD],
    };
}

/**
 * Get the LOD splat budget for a given quality tier.
 * @param tier - Resolved quality tier (SD or HD)
 * @returns Splat count budget for SparkRenderer
 */
export function getLodBudget(tier: string): number {
    const budgets = resolveLodBudgets();
    return budgets[tier] ?? budgets[QUALITY_TIER.HD];
}
