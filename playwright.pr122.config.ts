import { defineConfig, devices } from '@playwright/test'
import { e2eEnv, requireE2EConfig } from './tests/e2e/helpers/project-state'

// E2E pentru PR #122: browser real, API real, Supabase local (DB, Auth, Storage).
// Serverul Next (build, `next start`) și simulatorul Resend rulează separat:
//   node tests/e2e/helpers/resend-mock.mjs 4122 playwright-report/pr122/resend.jsonl
//   RESEND_API_KEY=re_test_fals RESEND_BASE_URL=http://127.0.0.1:4122 npx next start -p 3122
//   E2E_ENV_FILE=.env.e2e.pr122 npx playwright test --config playwright.pr122.config.ts
const config = requireE2EConfig(e2eEnv())
const CI = Boolean(process.env.CI)
// Pe o mașină fără dependențele de sistem ale WebKit se poate da un lansator local.
const webkitLaunch = process.env.E2E_WEBKIT_EXECUTABLE ? { executablePath: process.env.E2E_WEBKIT_EXECUTABLE } : {}
const local = { locale: 'ro-RO', timezoneId: 'Europe/Bucharest' }
// Fluxul 12 e al aparatelor cu atingere; restul, al calculatorului.
const TOUCH_ONLY = /12-telefon-tableta/

export default defineConfig({
  testDir: './tests/e2e/pr122',
  outputDir: './playwright-report/pr122/test-results',
  globalSetup: './tests/e2e/pr122/global-setup.ts',
  globalTeardown: './tests/e2e/pr122/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 2 : 0,
  reporter: [['list'], ['json', { outputFile: 'playwright-report/pr122/rezultate.json' }], ['html', { outputFolder: 'playwright-report/pr122/html', open: 'never' }]],
  use: {
    baseURL: config.baseUrl,
    trace: CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...local,
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: TOUCH_ONLY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, ...local },
    },
    {
      name: 'desktop-webkit',
      testIgnore: TOUCH_ONLY,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 }, launchOptions: webkitLaunch, ...local },
    },
    {
      name: 'telefon-chromium',
      testMatch: TOUCH_ONLY,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, ...local },
    },
    {
      name: 'tableta-chromium',
      testMatch: TOUCH_ONLY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true, ...local },
    },
    {
      name: 'telefon-webkit',
      testMatch: TOUCH_ONLY,
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, launchOptions: webkitLaunch, ...local },
    },
  ],
})
