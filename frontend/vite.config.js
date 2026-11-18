import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const envDir = fileURLToPath(new URL('../', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, ['VITE_OPNAVI_', 'OPNAVI_SECURITY_JS_CODE'])
  const region = env.VITE_OPNAVI_REGION === 'de' ? 'de' : 'sg'
  const securityCode = env.OPNAVI_SECURITY_JS_CODE

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    define: { __OPNAVI_PROXY_CONFIGURED__: Boolean(securityCode) },
    server: {
      port: 5173,
      proxy: {
        '/_AMapService/': {
          target: `https://${region}-restapi.opnavi.com`,
          changeOrigin: true,
          rewrite: path => path.slice('/_AMapService'.length),
          configure(proxy) {
            proxy.on('proxyReq', request => {
              request.removeHeader('cookie')
              request.removeHeader('authorization')
              const url = new URL(request.path, 'http://localhost')
              url.searchParams.set('jscode', securityCode || '')
              request.path = url.pathname + url.search
            })
          },
        },
      },
    },
  }
})
