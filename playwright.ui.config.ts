import { defineConfig, devices } from '@playwright/test'
import { uiConfig } from './tests/ui/helpers'

/**
 * Suita de interfață: doar citire.
 *
 * Are config propriu fiindcă `playwright.config.ts` păzește testele cu
 * scriere — cere o bază Supabase dedicată și porțile `E2E_WRITES` /
 * `E2E_TEST_PROJECT`. Testele de aici nu modifică nimic, deci n-au ce căuta
 * după acele porți, iar lipsa lor n-ar trebui să le blocheze.
 *
 * Serverul se pornește separat: `npm run dev`, apoi `npm run test:ui`.
 */
const config = uiConfig()

/**
 * iOS e alt motor de randare, nu altă lățime.
 *
 * `dvh`, `env(safe-area-inset-*)` și `backdrop-blur` — toate trei folosite în
 * aplicație — se comportă diferit în WebKit față de Chromium, iar pe iPhone
 * *orice* browser e WebKit. Proiectul există, dar stă în spatele unui steag
 * fiindcă pe Linux cere biblioteci de sistem instalate cu `sudo`
 * (`npx playwright install-deps webkit`). Pe o mașină pregătită:
 * `npm run test:ui:iphone`.
 */
const CU_WEBKIT = !!process.env.UI_IPHONE

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  // Pe CI un test picat o dată nu e neapărat un test picat: rețeaua și baza
  // sunt partajate. Local nu se reia nimic — o reluare tăcută ascunde exact
  // instabilitatea pe care vrei s-o vezi cât scrii.
  retries: process.env.CI ? 2 : 0,
  /**
   * Raportul HTML e obligatoriu pentru partea de telefon: singurul mod de a
   * înțelege „elementul iese 40px în dreapta” e captura și urma de la momentul
   * căderii, iar `list` nu le arată. `open: 'never'` ca să nu deschidă un
   * browser peste rulare.
   */
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/ui' }]],
  use: {
    baseURL: config.baseUrl,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  /**
   * Trei aparate în rulajul implicit, nu zece.
   *
   * Peste patru dispozitive câștigul se plafonează, iar timpul de rulare nu:
   * lățimile se acoperă mult mai ieftin din `adaptiv.spec.ts`, care mătură zece
   * praguri într-un singur browser. Proiectele de aici sunt pentru ce nu ține
   * de lățime — degetul, lipsa mausului, motorul.
   */
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'telefon',
      use: { ...devices['Pixel 7'] },
    },
    {
      // Tableta prinde exact pragul `md:` (768px) cu ecran tactil: acolo se
      // schimbă chatul din două coloane în una și panoul de faze din coloană
      // în sertar. Rulează doar suita de telefon — restul ecranelor sunt deja
      // măturate la lățimea asta de `adaptiv.spec.ts`.
      //
      // Motorul e Chromium, deși iPad-ul real e WebKit: descriptorul aduce
      // lățimea, densitatea și atingerea, care sunt ce se verifică aici.
      // Verificarea pe motorul adevărat e proiectul `iphone`.
      name: 'tableta',
      testMatch: /mobil.*\.spec\.ts/,
      use: { ...devices['iPad Mini'], browserName: 'chromium' },
    },
    ...(CU_WEBKIT ? [{
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
    }] : []),
  ],
})
