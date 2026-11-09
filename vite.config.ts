import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @dusrel codec packages resolve their WASM/glue assets relative to
  // their own module URL. Vite's dev pre-bundling relocates dependency
  // code, which breaks that relative resolution — excluding the codec
  // packages from pre-bundling keeps them served from their real
  // location so the default asset URLs work in dev. (Production builds
  // work either way; alternatively use setCodecAssets with ?url
  // imports, as demonstrated in src/App.tsx.)
  optimizeDeps: {
    exclude: [
      '@dusrel/image-jpeg',
      '@dusrel/image-webp',
      '@dusrel/image-avif',
      '@dusrel/image-png',
      '@dusrel/image-oxipng',
      '@dusrel/image-quantize',
      '@dusrel/image-resize',
      '@dusrel/image-jxl',
      '@dusrel/image-qoi',
      '@dusrel/image-heic',
      '@dusrel/image-gif',
    ],
  },
})
