import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5178'

export default defineConfig({
  testDir: './tests',
  use: { baseURL, channel: process.env.PLAYWRIGHT_CHANNEL },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort',
    url: baseURL,
  },
})
