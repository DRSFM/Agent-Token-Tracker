import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), 'TOKEN_TRACKER_')
  const cloudEnv = {
    TOKEN_TRACKER_SUPABASE_URL:
      process.env.TOKEN_TRACKER_SUPABASE_URL ?? loadedEnv.TOKEN_TRACKER_SUPABASE_URL ?? '',
    TOKEN_TRACKER_SUPABASE_ANON_KEY:
      process.env.TOKEN_TRACKER_SUPABASE_ANON_KEY ?? loadedEnv.TOKEN_TRACKER_SUPABASE_ANON_KEY ?? '',
  }
  Object.assign(process.env, loadedEnv, cloudEnv)

  return {
    plugins: [
      react(),
      electron({
        main: {
          entry: 'electron/main.ts',
          vite: {
            // Supabase's publishable key is intentionally public. Embed the
            // build-time values so packaged apps do not depend on runtime env.
            define: {
              'process.env.TOKEN_TRACKER_SUPABASE_URL': JSON.stringify(cloudEnv.TOKEN_TRACKER_SUPABASE_URL),
              'process.env.TOKEN_TRACKER_SUPABASE_ANON_KEY': JSON.stringify(cloudEnv.TOKEN_TRACKER_SUPABASE_ANON_KEY),
            },
            build: {
              rollupOptions: {
                external: ['sqlite3'],
              },
            },
          },
        },
        preload: {
          input: path.join(__dirname, 'electron/preload.ts'),
        },
        renderer: {},
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
    },
  }
})
