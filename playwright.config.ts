import 'dotenv/config';

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const localServer = !process.env.E2E_BASE_URL;
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: 'output/ui-audit/test-results',
  reporter: [
    ['list'],
    [
      'html',
      { outputFolder: 'output/ui-audit/playwright-report', open: 'never' },
    ],
    ['json', { outputFile: 'output/ui-audit/audit-results.json' }],
  ],
  use: {
    baseURL,
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: localServer
    ? {
        command: 'npm run start -- -H 127.0.0.1 -p 3100',
        env: {
          ...inheritedEnvironment,
          APP_URL: baseURL,
          AUTH_URL: baseURL,
          PASSKEY_ORIGIN: baseURL,
          PASSKEY_RP_ID: new URL(baseURL).hostname,
        },
        reuseExistingServer: false,
        timeout: 30_000,
        url: baseURL,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'mobile-chromium-landscape',
      use: { ...devices['Pixel 7 landscape'], browserName: 'chromium' },
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 15'], browserName: 'webkit' },
    },
    {
      name: 'mobile-webkit-landscape',
      use: { ...devices['iPhone 15 landscape'], browserName: 'webkit' },
    },
  ],
});
