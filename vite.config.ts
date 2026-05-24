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
  plugins: [devtools(), tailwindcss(), ...frameworkPlugins],
})

export default config
