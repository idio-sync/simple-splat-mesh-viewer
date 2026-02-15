/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectDeviceTier, resolveQualityTier, hasAnyProxy } from '../quality-tier.js';

// Store original values for restoration
let originalDeviceMemory: PropertyDescriptor | undefined;
let originalHardwareConcurrency: PropertyDescriptor | undefined;
let originalUserAgent: PropertyDescriptor | undefined;
let originalScreenWidth: PropertyDescriptor | undefined;

describe('hasAnyProxy', () => {
    it('returns true when hasMeshProxy is true', () => {
        expect(hasAnyProxy({ hasMeshProxy: true })).toBe(true);
    });

    it('returns true when hasSceneProxy is true', () => {
        expect(hasAnyProxy({ hasSceneProxy: true })).toBe(true);
    });

    it('returns true when both are true', () => {
        expect(hasAnyProxy({ hasMeshProxy: true, hasSceneProxy: true })).toBe(true);
    });

    it('returns false when both are false', () => {
        expect(hasAnyProxy({ hasMeshProxy: false, hasSceneProxy: false })).toBe(false);
    });

    it('returns false when both are undefined', () => {
        expect(hasAnyProxy({ hasMeshProxy: undefined, hasSceneProxy: undefined })).toBe(false);
    });

    it('returns false for empty object', () => {
        expect(hasAnyProxy({})).toBe(false);
    });
});

describe('resolveQualityTier', () => {
    it("returns 'sd' when tier is 'sd'", () => {
        expect(resolveQualityTier('sd')).toBe('sd');
    });

    it("returns 'hd' when tier is 'hd'", () => {
        expect(resolveQualityTier('hd')).toBe('hd');
    });

    it("calls detectDeviceTier when tier is 'auto'", () => {
        const result = resolveQualityTier('auto');
        // detectDeviceTier returns either 'sd' or 'hd'
        expect(['sd', 'hd']).toContain(result);
    });

    it('calls detectDeviceTier for unknown tier values', () => {
        const result = resolveQualityTier('unknown');
        expect(['sd', 'hd']).toContain(result);
    });
});

describe('detectDeviceTier', () => {
    beforeEach(() => {
        // Save original descriptors
        originalDeviceMemory = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory');
        originalHardwareConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');
        originalUserAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent');
        originalScreenWidth = Object.getOwnPropertyDescriptor(Screen.prototype, 'width');
    });

    afterEach(() => {
        // Restore original values
        if (originalDeviceMemory) {
            Object.defineProperty(Navigator.prototype, 'deviceMemory', originalDeviceMemory);
        } else {
            delete (Navigator.prototype as any).deviceMemory;
        }

        if (originalHardwareConcurrency) {
            Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', originalHardwareConcurrency);
        } else {
            delete (Navigator.prototype as any).hardwareConcurrency;
        }

        if (originalUserAgent) {
            Object.defineProperty(Navigator.prototype, 'userAgent', originalUserAgent);
        }

        if (originalScreenWidth) {
            Object.defineProperty(Screen.prototype, 'width', originalScreenWidth);
        }
    });

    it('returns hd for desktop with high-end specs (score 5/5)', () => {
        // Mock all capabilities as high-end
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8 // 8GB
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8 // 8 cores
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920 // Desktop resolution
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        // Mock GL context
        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 16384; // High texture size
                return null;
            })
        } as any;

        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('returns sd for mobile device with low memory (score < 3)', () => {
        // Mock mobile with low specs
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 2 // 2GB (below threshold)
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 2 // 2 cores (below threshold)
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 375 // Mobile resolution (below threshold)
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) Mobile'
        });

        // Mock GL context with low texture size
        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096; // Below threshold (8192)
                return null;
            })
        } as any;

        expect(detectDeviceTier(mockGl)).toBe('sd');
    });

    it('assumes capable when deviceMemory is undefined', () => {
        // Mock undefined deviceMemory (Safari, Firefox)
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => 16384)
        } as any;

        // Should score 5/5 (undefined deviceMemory counts as 1 point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('assumes capable when hardwareConcurrency is undefined', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => undefined
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => 16384)
        } as any;

        // Should score 5/5 (undefined hardwareConcurrency counts as 1 point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('assumes capable when GL context is null', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        // No GL context provided
        expect(detectDeviceTier()).toBe('hd');
    });

    it('loses texture point when GL returns low MAX_TEXTURE_SIZE', () => {
        // Mock high-end except for texture size
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn((param) => {
                if (param === 0x0D33) return 4096; // Below threshold (8192)
                return null;
            })
        } as any;

        // Should score 4/5 (loses texture point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('handles GL getParameter throwing error gracefully', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 8
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1920
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        });

        const mockGl = {
            MAX_TEXTURE_SIZE: 0x0D33,
            getParameter: vi.fn(() => {
                throw new Error('GL error');
            })
        } as any;

        // Should assume capable when error occurs (still scores point)
        expect(detectDeviceTier(mockGl)).toBe('hd');
    });

    it('detects iPad as mobile device', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 4
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 6
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 1024
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)'
        });

        // Should lose mobile point (score 4/5 without GL, still HD)
        expect(detectDeviceTier()).toBe('hd');
    });

    it('detects Android as mobile device', () => {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            configurable: true,
            get: () => 3
        });
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            configurable: true,
            get: () => 4
        });
        Object.defineProperty(Screen.prototype, 'width', {
            configurable: true,
            get: () => 412
        });
        Object.defineProperty(Navigator.prototype, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 (Linux; Android 11; Pixel 5)'
        });

        // Score: 0 (mem) + 1 (cores) + 0 (width) + 1 (no GL) + 0 (mobile) = 2 -> SD
        expect(detectDeviceTier()).toBe('sd');
    });
});
