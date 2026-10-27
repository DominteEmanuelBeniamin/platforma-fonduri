import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { AccountRegistry, config, destroyProject, destroyTemplate, ensureReportDir, type Account } from './support'

// Sesiunile Supabase durează o oră; o stare mai veche de 30 de minute se reface
// printr-un login nou (refresh token-urile sunt de unică folosință).
const STATE_MAX_AGE_MS = 30 * 60_000

export type Team = {
  admin: Account
  senior: Account
  junior: Account
  /** Junior care nu e în echipa proiectelor de test. */
  outsider: Account
  client: Account
}

type WorkerFixtures = {
  team: Team & { statePath: (account: Account) => Promise<string> }
}

/** Ce a creat testul și trebuie șters la final, oricum s-ar termina. */
export class Seeds {
  readonly projects = new Set<string>()
  readonly templates = new Set<string>()
}

type TestFixtures = {
  seeds: Seeds
  /** O pagină nouă, autentificată ca `account`, cu opțiunile proiectului curent. */
  as: (account: Account, extra?: BrowserContextOptions) => Promise<Page>
  /** Un context nou, fără sesiune (de exemplu, unul cu atingere). */
  newContext: (extra?: BrowserContextOptions) => Promise<BrowserContext>
  /**
   * O pagină cu o sesiune doar a ei, prin login real. Pentru paginile al căror
   * ceas e mutat înainte: tokenul pare expirat, supabase-js îl reîmprospătează,
   * iar o sesiune împărțită prin `storageState` le-ar scoate pe celelalte din cont.
   */
  loginFresh: (account: Account, extra?: BrowserContextOptions) => Promise<Page>
}

/** Opțiunile de context ale proiectului (viewport, atingere, fus orar), pentru contextele create de mână. */
export function projectContextOptions(info: TestInfo): BrowserContextOptions {
  const use = info.project.use
  return {
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    locale: use.locale,
    timezoneId: use.timezoneId,
  }
}

async function loginState(browser: Browser, account: Account, file: string) {
  const context = await browser.newContext({ baseURL: config.baseUrl, locale: 'ro-RO', timezoneId: 'Europe/Bucharest' })
  try {
    await new LoginPage(await context.newPage()).login(account.email, account.password)
    await context.storageState({ path: file })
  } finally {
    await context.close()
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  team: [async ({ browser }, provide, workerInfo) => {
    const label = 'w' + workerInfo.workerIndex + workerInfo.project.name.replace(/[^a-z]/gi, '').slice(0, 8)
    const registry = new AccountRegistry(label)
    const dir = ensureReportDir('.auth')
    const files = new Set<string>()
    try {
      const team: Team = {
        admin: await registry.create('admin', 'E2E122 Ada Admin'),
        senior: await registry.create('senior', 'E2E122 Sorin Senior'),
        junior: await registry.create('junior', 'E2E122 Ioana Junior'),
        outsider: await registry.create('junior', 'E2E122 Emil Extern'),
        client: await registry.create('client', 'E2E122 Firma Client'),
      }
      const made = new Map<string, number>()
      const statePath = async (account: Account) => {
        const file = path.join(dir, `${workerInfo.project.name}-${workerInfo.workerIndex}-${account.id}.json`)
        const at = made.get(account.id)
        if (!at || Date.now() - at > STATE_MAX_AGE_MS || !fs.existsSync(file)) {
          await loginState(browser, account, file)
          made.set(account.id, Date.now())
          files.add(file)
        }
        return file
      }
      await provide({ ...team, statePath })
    } finally {
      // Fișierele conțin tokenuri de sesiune; nu rămân pe disc după rulare.
      for (const file of files) fs.rmSync(file, { force: true })
      await registry.cleanup()
    }
  }, { scope: 'worker', timeout: 180_000 }],

  seeds: async ({}, provide) => {
    const seeds = new Seeds()
    await provide(seeds)
    // Proiectele întâi: un șablon folosit de un proiect nu se poate șterge.
    for (const id of seeds.projects) await destroyProject(id)
    for (const id of seeds.templates) await destroyTemplate(id)
  },

  newContext: async ({ browser }, provide, testInfo) => {
    const contexts: BrowserContext[] = []
    await provide(async (extra = {}) => {
      const context = await browser.newContext({ ...projectContextOptions(testInfo), ...extra })
      contexts.push(context)
      return context
    })
    if (testInfo.status !== testInfo.expectedStatus) {
      // Capturile tuturor paginilor deschise, ca la `screenshot: only-on-failure`.
      let n = 0
      for (const context of contexts) {
        for (const page of context.pages()) {
          const file = testInfo.outputPath(`esec-${++n}.png`)
          await page.screenshot({ path: file }).catch(() => {})
          if (fs.existsSync(file)) await testInfo.attach(`pagina ${n}`, { path: file, contentType: 'image/png' })
        }
      }
    }
    for (const context of contexts) await context.close()
  },

  loginFresh: async ({ newContext }, provide) => {
    await provide(async (account, extra = {}) => {
      const page = await (await newContext(extra)).newPage()
      await new LoginPage(page).login(account.email, account.password)
      // Loginul mai face o redirecționare spre „/”; o navigare pornită înainte
      // ca prima pagină să se încarce era întreruptă de ea (pe WebKit).
      await expect(page.getByRole('heading', { level: 1, name: /^Salut/ })).toBeVisible()
      return page
    })
  },

  as: async ({ team, newContext }, provide) => {
    await provide(async (account, extra = {}) => {
      const context = await newContext({ ...extra, storageState: await team.statePath(account) })
      return context.newPage()
    })
  },
})

export { expect }
