// Runs the static site on a local server and drives it in Chromium.
// Set CHROME_PATH to use an installed Chrome instead of Playwright's download.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    serviceWorkers: 'block',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: {
    command: 'python3 -m http.server 4173 -d ..',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
