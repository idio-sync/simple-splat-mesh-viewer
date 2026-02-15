/**
 * URL validation for user-entered URLs.
 * Prevents loading from untrusted sources by checking protocol and domain allowlists.
 *
 * Extracted from main.js to make it testable and reusable.
 */

export interface ValidationResult {
    valid: boolean;
    url: string;
    error: string;
}

/**
 * Validates a URL to prevent loading from untrusted sources.
 * Used for URLs entered by users via prompt dialogs.
 *
 * @param urlString - The URL string to validate
 * @param resourceType - Type of resource (for log messages)
 * @param options - Validation context
 * @param options.allowedDomains - List of allowed external domains (supports *.example.com wildcards)
 * @param options.currentOrigin - The current page origin (for same-origin checks)
 * @param options.currentProtocol - The current page protocol (for HTTPS enforcement)
 */
export function validateUserUrl(
    urlString: string,
    resourceType: string,
    options: {
        allowedDomains?: string[];
        currentOrigin?: string;
        currentProtocol?: string;
    } = {}
): ValidationResult {
    const {
        allowedDomains = [],
        currentOrigin = '',
        currentProtocol = 'https:'
    } = options;

    if (!urlString || urlString.trim() === '') {
        return { valid: false, url: '', error: 'URL is empty' };
    }

    try {
        // Parse the URL (relative URLs resolved against current origin)
        const url = new URL(urlString.trim(), currentOrigin || undefined);

        // Block dangerous protocols
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) {
            return {
                valid: false,
                url: '',
                error: `Unsafe protocol "${url.protocol}" is not allowed. Use http: or https:`
            };
        }

        // Check if same-origin
        const isSameOrigin = currentOrigin ? url.origin === currentOrigin : false;

        // Check if domain is in allowed list
        const isAllowedExternal = allowedDomains.some(domain => {
            if (domain.startsWith('*.')) {
                const baseDomain = domain.slice(2);
                return url.hostname === baseDomain || url.hostname.endsWith('.' + baseDomain);
            }
            return url.hostname === domain;
        });

        if (!isSameOrigin && !isAllowedExternal) {
            return {
                valid: false,
                url: '',
                error: `External domain "${url.hostname}" is not allowed.\n\nOnly same-origin URLs are permitted by default. Contact the administrator to allow this domain.`
            };
        }

        // Enforce HTTPS for external URLs when page is served over HTTPS
        if (!isSameOrigin && currentProtocol === 'https:' && url.protocol !== 'https:') {
            return {
                valid: false,
                url: '',
                error: 'External URLs must use HTTPS when the viewer is served over HTTPS.'
            };
        }

        return { valid: true, url: url.href, error: '' };

    } catch (e: any) {
        return {
            valid: false,
            url: '',
            error: `Invalid URL format: ${e.message}`
        };
    }
}
