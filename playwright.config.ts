import { defineConfig, devices } from '@playwright/test'
import { e2eEnv, requireE2EConfig } from './tests/e2e/helpers/project-state'

// URL-ul este obligatoriu și vine din configurația dedicată; nu există
// fallback la un server implicit care ar putea fi pornit pe altă bază.
const config = requireE2EConfig(e2eEnv())

/** Serverul se pornește separat în mediul descris de `.env.e2e.local`. */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: config.baseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
