import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5183'
const backend = 'http://127.0.0.1:8013'

export default defineConfig({
  testDir: './tests',
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL, reducedMotion: 'reduce' },
  webServer: [
    {
      cwd: '../backend',
      command: 'python -m uvicorn app.main:app --host 127.0.0.1 --port 8013 --no-access-log',
      url: backend + '/health',
      env: { DATABASE_URL: '', CORS_ORIGINS: baseURL },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort',
      url: baseURL,
      env: {
        VITE_API_BASE_URL: backend + '/api/v1',
        VITE_OPNAVI_REGION: 'sg',
        VITE_OPNAVI_API_KEY: 'test-web-key',
        OPNAVI_SECURITY_JS_CODE: 'test-server-code',
      },
    },
  ],
})
