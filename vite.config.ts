// Bundle analysis: Run `npx vite-bundle-visualizer` or add
// `import { visualizer } from 'rollup-plugin-visualizer'` to plugins
// with `visualizer({ open: true, gzipSize: true })` for analysis.
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { nitro } from 'nitro/vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const deployTarget = process.env.DEPLOY_TARGET
const frameworkPlugins =
  deployTarget === 'cloudflare'
    ? [
        ...cloudflare({
          viteEnvironment: { name: 'ssr' },
        }),
        tanstackStart(),
        viteReact(),
      ]
    : deployTarget === 'vercel'
      ? [
          tanstackStart(),
          ...nitro({ preset: process.env.NITRO_PRESET ?? 'vercel' }),
          viteReact(),
        ]
      : [tanstackStart(), viteReact()]

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          // Group by top-level package name for better caching
          const match = id.match(/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
          if (!match) return 'vendor'
          const [, packageName] = match
          // Separate known large packages for parallel loading
          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') return 'vendor-react'
          if (packageName.startsWith('@clerk/')) return 'vendor-auth'
          if (packageName === 'convex') return 'vendor-convex'
          if (packageName === 'lucide-react') return 'vendor-icons'
          if (packageName.startsWith('@tanstack/')) return 'vendor-router'
          // Group all other node_modules by top-level package for optimal caching
          return `vendor-${packageName.replace(/[@/]/g, '_')}`
        },
      },
    },
  },
  plugins: [devtools(), tailwindcss(), ...frameworkPlugins],
})

export default config
