# @dusrel/image — consumer test project

A deliberately separate React + Vite + TypeScript project that consumes
the **published** `@dusrel/*` packages from the npm registry (all
`1.0.0`), created after the first release to verify the packages the
way a real user would hit them. Nothing here links back to the
monorepo — `package-lock.json` resolves every `@dusrel/*` tarball from
registry.npmjs.org.

## What is tested

**`npm run build`** — `tsc -b && vite build` over `src/App.tsx`. The
app is a live test bench (deployed at
dusrel-consumer-test.pages.dev): on page load it runs **25 in-browser
checks covering every installed package** — all eleven codec packages
(JPEG/WebP/PNG encode + roundtrips, AVIF, JXL, QOI, GIF + optimise,
HEIC decode of `public/sample.heic`, a libheif example file), the
feature packages (oxipng, quantize, resize, transform, adjust,
metadata EXIF GPS + strip, watermark, SVG), and the platform layer
(core `processImage`, flagship `processImage` with a registered AVIF
codec, batch pool ordering, crop geometry, placeholder roundtrips) —
plus interactive `useProcessImage` and `DusrelCrop` demos from
`@dusrel/image-react`. A header pill counts the checks as they pass.

**`node scripts/smoke.mjs`** — a 43-check pack-smoke suite against the
installed packages: export surface of all 22 installed packages, real
encode/decode roundtrips for every WASM codec (JPEG, WebP lossless
pixel-exact, PNG pixel-exact, QOI pixel-exact, AVIF, JXL lossless
pixel-exact, GIF 2-frame with delays, oxipng), a hand-built EXIF GPS
JPEG parsed by `@dusrel/image-metadata` (28.6, −77.2) plus metadata
stripping, and the pure feature packages (transform, adjust —
grayscale(red) = 54, watermark layout, batch ordering, crop geometry,
SVG optimisation) plus the React processor store running headless.
Two Node-harness shims are documented at the top of the script
(ImageData global, file:-URL fetch) — both emulate what a browser
provides natively.

**Dev server / preview probing** — `vite preview` serves the page and
every emitted codec asset (byte-exact sizes). The dev server was
probed at the URL level for both asset strategies.

## Results (2026-11-08, packages @ 1.0.0)

- Install from registry: OK (22 packages; `@dusrel/image-vue` and
  `-svelte` intentionally not installed — wrong framework here).
- Node pack-smoke: **43/43 passed.**
- Production build + preview: OK — Vite emits all codec `.wasm`/glue
  files as assets and rewrites the loaders' default URLs correctly.
- **Dev-mode trap found and fixed:** with default config, Vite's
  dependency pre-bundling relocates codec code, so the loaders'
  default asset URLs resolve into `node_modules/.vite/` and the WASM
  fetch returns the page HTML. Both documented fixes were verified at
  the URL level:
  - `optimizeDeps.exclude` for the codec packages (applied in this
    project's `vite.config.ts`) — dev then serves the packages from
    their real location and rewrites the asset URLs correctly;
  - `setCodecAssets` with `?url` imports (demonstrated in
    `src/App.tsx`) — every URL serves the right content in dev.
  The monorepo docs gained a "WASM codecs with Vite" quickstart
  section with both recipes.
- Minor notes: the React/Vue/Svelte processor stores type their
  `error` state as `unknown` (narrow with `instanceof Error`);
  `stripMetadata` on a degenerate EXIF-only JPEG (no image data at
  all — not a real photo file) drops the trailing EOI marker;
  realistic JPEG layouts strip correctly.
