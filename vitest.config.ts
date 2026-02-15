import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            'three/addons/': 'three/examples/jsm/',
        },
    },
    test: {
        include: ['src/**/__tests__/**/*.test.{ts,js}'],
        globals: true,
    },
});
