const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5001',
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}),
    viewport: {width: 390, height: 844},
    serviceWorkers: 'block',
  },
  projects: [
    {name: 'workouts', testIgnore: '**/access.spec.cjs'},
    {name: 'access', testMatch: '**/access.spec.cjs', use: {baseURL: 'http://127.0.0.1:5002', serviceWorkers: 'allow'}},
  ],
  webServer: [{
    command: `"${process.env.PYTHON || 'python'}" tests/browser_server.py`,
    url: 'http://127.0.0.1:5001',
    reuseExistingServer: false,
  }, {
    command: `"${process.env.PYTHON || 'python'}" tests/production_server.py`,
    url: 'http://127.0.0.1:5002/healthz',
    reuseExistingServer: false,
  }],
});
