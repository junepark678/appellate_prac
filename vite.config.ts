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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (id.includes('/@clerk/')) return 'vendor-auth'
          if (id.includes('/convex/')) return 'vendor-convex'
          if (id.includes('/lucide-react/')) return 'vendor-icons'
          if (id.includes('/@tanstack/')) return 'vendor-router'
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/scheduler')
          ) {
            return 'vendor-react'
          }
          return 'vendor'
        },
      },
    },
  },
  plugins: [devtools(), tailwindcss(), ...frameworkPlugins],
})

export default config
