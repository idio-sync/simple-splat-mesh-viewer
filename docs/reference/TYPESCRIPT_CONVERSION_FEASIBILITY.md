# TypeScript Conversion Feasibility Evaluation

**Date:** 2026-02-06
**Scope:** Full assessment of converting simple-splat-mesh-viewer from JavaScript to TypeScript
**Codebase:** 13,403 lines of JavaScript across 16 ES module files

---

## Executive Summary

Converting this project to TypeScript is **feasible and recommended**, but requires a bundler introduction (Vite recommended) and a phased migration strategy. The codebase is well-structured with clean module boundaries, existing JSDoc annotations, and no CommonJS/ESM mixing — all factors that significantly reduce conversion risk. The primary complexity lies in the CDN import map architecture, which must be replaced with a proper build pipeline.

### Feasibility Rating: **High** (8/10)

| Factor | Rating | Notes |
|--------|--------|-------|
| Module structure | 9/10 | Clean ESM, clear exports, good separation |
| Existing type hints | 7/10 | JSDoc present in most modules, inconsistent in main.js |
| Dependency typing | 7/10 | `@types/three` excellent; spark.js has no types |
| Build complexity | 5/10 | Requires introducing a bundler (currently none) |
| Data model complexity | 7/10 | Complex nested metadata, but well-documented structures |
| Risk level | Low-Medium | No existing tests to break; phased approach mitigates risk |

---

## 1. Current Architecture Analysis

### Module System
- **Pure ES Modules** with `"type": "module"` in `package.json`
- **No bundler** — files served directly via `npx serve src -p 8080`
- **Import map** in `index.html` resolves bare specifiers to CDN URLs (esm.sh, sparkjs.dev)
- All inter-module imports use relative paths with `.js` extensions

### File Inventory

| File | Lines | Complexity | Type Difficulty |
|------|-------|-----------|-----------------|
| `main.js` | 3,993 | High | Hard — orchestrator with DOM, Three.js, and state |
| `metadata-manager.js` | 1,448 | High | Medium — mostly DOM operations with known shapes |
| `archive-creator.js` | 1,261 | High | Medium — well-documented JSDoc, clear data flow |
| `file-handlers.js` | 1,033 | High | Medium — dependency injection pattern helps |
| `alignment.js` | 970 | High | Easy — algorithmic, clear input/output types |
| `utilities.js` | 871 | Medium | Easy — utility functions with existing JSDoc |
| `kiosk-viewer.js` | 635 | Medium | Medium — generates HTML strings |
| `ui-controller.js` | 576 | Medium | Easy — thin DOM wrappers |
| `share-dialog.js` | 559 | Medium | Easy — URL parameter serialization |
| `annotation-system.js` | 521 | Medium | Easy — well-typed JSDoc, clean class |
| `scene-manager.js` | 466 | Medium | Easy — Three.js class, existing null inits |
| `archive-loader.js` | 471 | Medium | Easy — well-documented, clear API |
| `fly-controls.js` | 236 | Low | Easy — simple class with known Three.js types |
| `config.js` | 187 | Low | Special — IIFE, must remain JS (see Section 3) |
| `constants.js` | 161 | Low | Trivial — pure data, `as const` conversion |
| `pre-module.js` | 15 | Low | Trivial |

### Existing JSDoc Coverage
Modules with strong JSDoc (easier conversion):
- `archive-creator.js` — 43 doc blocks with `@param`/`@returns` types
- `utilities.js` — 35 doc blocks
- `annotation-system.js` — 29 doc blocks with `@typedef`
- `file-handlers.js` — 26 doc blocks
- `archive-loader.js` — 25 doc blocks

Modules with weak/no JSDoc (more manual work):
- `main.js` — minimal type annotations despite being the largest file
- `kiosk-viewer.js` — limited annotations

---

## 2. Dependency Type Availability

| Dependency | Version | Types Available | Notes |
|------------|---------|----------------|-------|
| `three` | 0.170.0 | `@types/three` (DefinitelyTyped) | Excellent coverage, well-maintained |
| `@sparkjsdev/spark` | 0.1.10 | **None** | Needs `.d.ts` declaration file |
| `fflate` | 0.8.2 | Bundled | Written in TypeScript natively |
| `three-e57-loader` | 1.2.0 | **None** | Needs `.d.ts` declaration file |
| `web-e57` | 1.2.0 | **None** | Needs `.d.ts` declaration file |

### Type Declarations Needed

**`@sparkjsdev/spark`** — Used for `SplatMesh` class. Requires a declaration covering:
```typescript
// types/spark.d.ts (approximate)
declare module '@sparkjsdev/spark' {
  import { Object3D } from 'three';
  export class SplatMesh extends Object3D {
    static NewAsync(config: {
      renderer: THREE.WebGLRenderer;
      maxSplats: number;
      loadingAnimDuration: number;
    }): Promise<SplatMesh>;
    loadUrl(url: string, onProgress?: (progress: number) => void): Promise<void>;
    loadFile(file: File, onProgress?: (progress: number) => void): Promise<void>;
    dispose(): void;
  }
}
```

**`three-e57-loader`** — Used for `E57Loader`. Requires:
```typescript
declare module 'three-e57-loader' {
  import { Loader, Points } from 'three';
  export class E57Loader extends Loader {
    load(url: string, onLoad: (points: Points) => void,
         onProgress?: (event: ProgressEvent) => void,
         onError?: (error: Error) => void): void;
  }
}
```

**`web-e57`** — WASM support module. Minimal declaration needed:
```typescript
declare module 'web-e57' {
  export function init(): Promise<void>;
}
```

---

## 3. Build Pipeline Changes Required

### Current Setup (No Bundler)
```
index.html → <script type="importmap"> → CDN URLs
           → <script src="config.js">  → IIFE sets window.APP_CONFIG
           → <script type="module" src="main.js">
```

### Required Setup (Vite Recommended)
```
vite.config.ts → TypeScript compilation
              → Bundle resolution (replaces import map)
              → Dev server with HMR
              → Production build output
```

### Why Vite
- Native ESM dev server (matches current architecture)
- First-class TypeScript support (no separate tsc build step for dev)
- Import map can be dropped — Vite resolves bare specifiers via `node_modules`
- Minimal config for this project's needs
- Hot module replacement accelerates development

### `config.js` Special Case
`config.js` is loaded as a non-module `<script>` that runs before the module graph, setting `window.APP_CONFIG` from URL parameters. Two options:

1. **Keep as JS**: Load via Vite's `public/` directory, unchanged. Reference `window.APP_CONFIG` through a typed wrapper.
2. **Convert to TS module**: Move URL parsing into the module graph, import before `main.ts`. This is cleaner but changes load ordering.

**Recommendation:** Option 2 — convert `config.ts` to an exported module, import it as the first thing in `main.ts`.

### Docker Impact
The Docker build currently serves static files from `src/`. After Vite introduction:
- Build step added: `vite build` produces `dist/`
- Docker serves `dist/` instead of `src/`
- CI workflow needs `npm ci && npm run build` before Docker build

---

## 4. Key Type Definitions Required

The codebase has several core data structures that need formal interfaces. These are already well-documented in JSDoc and archive-creator.js comments.

### Core Interfaces

```typescript
// Transform data used throughout alignment, archives, sharing
interface Transform {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: number;
}

// Annotation placed in 3D space
interface Annotation {
  id: string;
  title: string;
  body: string;
  position: { x: number; y: number; z: number };
  camera_target: { x: number; y: number; z: number };
  camera_position: { x: number; y: number; z: number };
}

// Archive manifest structure
interface ArchiveManifest {
  version: string;
  packer: string;
  created: string;
  metadata: ProjectMetadata;
  alignment: {
    splat: Transform;
    model: Transform;
    pointcloud: Transform;
  };
  assets: Array<{
    path: string;
    type: 'splat' | 'model' | 'pointcloud';
    size: number;
  }>;
  annotations: Annotation[];
  integrity: {
    algorithm: string;
    manifest_hash: string;
    asset_hashes: Record<string, string>;
  };
}

// Metadata (largest interface — 60+ fields across 8 categories)
interface ProjectMetadata {
  // Project
  title: string;
  id: string;
  description: string;
  license: string;
  // ... (extensive, maps to Dublin Core / EDAN / PRONOM standards)
}
```

### Global Augmentations
```typescript
// window.APP_CONFIG, window.THREE, window.notify
declare global {
  interface Window {
    APP_CONFIG: AppConfig;
    THREE: typeof import('three');
    notify: NotificationManager;
    moduleLoaded: boolean;
  }
}
```

---

## 5. Migration Strategy

### Recommended: Phased Incremental Migration

**Phase 0 — Build Pipeline Setup**
- Install Vite + TypeScript
- Create `tsconfig.json` with `strict: false` initially (allows gradual strictness)
- Move dependencies from CDN import map to `node_modules`
- Verify app runs identically through Vite dev server
- Update Docker build to use Vite output

**Phase 1 — Foundation Types (Low-Risk Files)**
- Rename and convert: `constants.js` → `constants.ts` (use `as const`)
- Rename and convert: `utilities.js` → `utilities.ts`
- Rename and convert: `fly-controls.js` → `fly-controls.ts`
- Create `types/` directory with core interfaces
- Create declaration files for untyped dependencies
- Enable `strict: true` for converted files via per-file `// @ts-check` or tsconfig paths

**Phase 2 — Module Conversion (Medium-Risk Files)**
- Convert standalone modules with clean APIs:
  - `scene-manager.js` → `scene-manager.ts`
  - `annotation-system.js` → `annotation-system.ts`
  - `archive-loader.js` → `archive-loader.ts`
  - `archive-creator.js` → `archive-creator.ts`
  - `alignment.js` → `alignment.ts`
  - `ui-controller.js` → `ui-controller.ts`
  - `share-dialog.js` → `share-dialog.ts`

**Phase 3 — Complex Module Conversion (Higher-Risk Files)**
- Convert remaining complex modules:
  - `file-handlers.js` → `file-handlers.ts`
  - `metadata-manager.js` → `metadata-manager.ts`
  - `kiosk-viewer.js` → `kiosk-viewer.ts`
  - `config.js` → `config.ts`

**Phase 4 — Main Module + Strict Mode**
- Convert `main.js` → `main.ts` (largest file, most dependencies)
- Enable `strict: true` globally
- Resolve all remaining `any` types
- Add strict null checks

### Alternate: Parallel JSDoc Approach
If the bundler introduction is too disruptive, an intermediate step is to add TypeScript checking to JS files using `// @ts-check` and `jsconfig.json`/`tsconfig.json` with `allowJs: true, checkJs: true`. This provides type checking without renaming files or changing the build, but loses many TypeScript benefits (enums, interfaces in code, generics).

---

## 6. Risk Assessment

### Low Risk
- **Module structure is clean** — dependency injection pattern means modules don't need to know about each other's internals
- **No test suite to break** — paradoxically, this removes a migration blocker (though tests should be added alongside or after conversion)
- **Well-separated concerns** — each module has a clear API surface
- **ESM already in use** — no CommonJS conversion needed

### Medium Risk
- **CDN to npm migration** — `@sparkjsdev/spark` loads from `sparkjs.dev`, not npm. Need to verify it's available on npm or vendor the module
- **`main.js` complexity** — at ~4,000 lines with extensive DOM manipulation and state, this is the hardest file to type correctly
- **`window` global state** — `window.APP_CONFIG`, `window.THREE`, `window.notify` need careful typing
- **Dynamic HTML generation** — `kiosk-viewer.js` generates complete HTML pages as strings; template literal types won't help here

### Low-Medium Risk
- **Three.js version pinning** — `@types/three` must match v0.170.0 exactly; minor version mismatches can cause type errors
- **No existing tests** — type errors may mask runtime bugs or introduce regressions that go undetected

### Mitigations
1. **Phase 0 is the critical gate** — if Vite setup breaks anything, stop and fix before proceeding
2. **Run the app manually after each phase** — until a test suite exists, manual smoke testing is essential
3. **Start with `strict: false`** — enables gradual adoption; flip to `strict: true` only in Phase 4
4. **Keep `.js` files working during migration** — Vite handles mixed `.ts`/`.js` imports seamlessly

---

## 7. Estimated Scope

| Phase | Files | Estimated Interfaces/Types | Complexity |
|-------|-------|---------------------------|------------|
| 0 — Build pipeline | Config files only | 0 | Medium (one-time) |
| 1 — Foundation | 3 files + types dir | ~10 interfaces | Low |
| 2 — Modules | 7 files | ~15 interfaces | Medium |
| 3 — Complex modules | 4 files | ~10 interfaces (incl. large metadata) | Medium-High |
| 4 — Main + strict | 1 file + global config | ~5 interfaces + strict audit | High |

**Total new type definitions needed:** ~40 interfaces/types
**Total files to convert:** 15 (excluding `pre-module.js` and `index.html`)

---

## 8. Tooling Recommendations

### Recommended `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": false,
    "allowJs": true,
    "checkJs": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["three"]
  },
  "include": ["src/**/*", "types/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Recommended `vite.config.ts`
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 8080,
  },
});
```

### New Dependencies
```json
{
  "devDependencies": {
    "typescript": "^5.7",
    "vite": "^6.0",
    "@types/three": "^0.170.0",
    "three": "^0.170.0"
  },
  "dependencies": {
    "three": "^0.170.0",
    "@sparkjsdev/spark": "^0.1.10",
    "fflate": "^0.8.2",
    "three-e57-loader": "^1.2.0",
    "web-e57": "^1.2.0"
  }
}
```

### CI/CD Updates
The GitHub Actions workflow (`docker-push.yml`) needs a build step:
```yaml
- name: Install dependencies
  run: npm ci

- name: Type check
  run: npx tsc --noEmit

- name: Build
  run: npm run build
```

---

## 9. Benefits of Converting

1. **Type safety across module boundaries** — the dependency injection pattern in `file-handlers.js` and `alignment.js` will benefit enormously from typed callback signatures
2. **Refactoring confidence** — renaming a field in the metadata interface will surface all call sites at compile time
3. **IDE support** — autocompletion for Three.js APIs, metadata fields, and archive structures
4. **Self-documenting code** — interfaces replace JSDoc for data structures; documentation and code stay in sync
5. **Catches real bugs** — common issues like passing `null` where `Object3D` is expected, or misspelling metadata field names, will be caught before runtime
6. **Future-proofing** — as a proof of concept that may be built upon, TypeScript makes onboarding new developers significantly faster
7. **Aligns with code review findings** — the existing CODE_REVIEW.md identifies "Missing Type Safety" as HIGH priority item 1.1

---

## 10. Conclusion

This project is a strong candidate for TypeScript conversion. The clean module architecture, existing JSDoc annotations, and dependency injection patterns all reduce migration risk. The main challenge is introducing a build pipeline (Vite) to replace the current CDN import map approach, but this is a one-time setup cost that also unlocks HMR, tree-shaking, and production optimizations.

The phased approach allows the project to remain functional at every step, with each phase independently delivering value. Starting with the build pipeline and foundation types provides immediate IDE improvements, while the later phases progressively add type safety to the more complex modules.

**Recommendation:** Proceed with conversion using the phased strategy outlined above, starting with Phase 0 (Vite setup) as a proof-of-concept before committing to the full migration.
