import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Dovezile unei suite pentru raportul de verificare: fiecare punct verificat,
 * cu ce s-a așteptat, ce s-a obținut și, unde există interfață, captura
 * paginii în acel moment. Se scriu în `playwright-report/dovezi/<suită>/`
 * (`dovezi.json` și capturile), ca raportul să le poată pune unul lângă altul.
 *
 * Verificările nu aruncă: o abatere devine un rând roșu în raport, iar testul
 * final al suitei cere zero abateri. Așa o abatere nu ascunde restul.
 */
export type Strat = 'Interfață' | 'API' | 'Bază de date' | 'Email' | 'Performanță'

export type Dovada = {
  nr: number
  zona: string
  /** Rândul din PDF, când punctul vine dintr-o matrice. */
  rand?: string
  cine: string
  punct: string
  asteptat: string
  obtinut: string
  ok: boolean
  strat: Strat
  /** Capturi în ordinea pașilor, relative la directorul suitei. */
  capturi: string[]
  /** Defect cunoscut dinainte: apare în raport, dar nu pică suita. */
  cunoscut?: boolean
  /** Față de PDF: „neschimbat”, „schimbat prin #104” etc. */
  fataDePdf?: string
}

function slug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function createDovezi(suite: string) {
  const dir = path.join('playwright-report', 'dovezi', suite)
  const items: Dovada[] = []
  let shots = 0

  return {
    dir,
    items,

    reset() {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
    },

    /** Captura paginii, ca JPEG: sute de capturi încap așa în raport. */
    async captura(page: Page, nume: string, options: { fullPage?: boolean } = {}) {
      shots += 1
      const file = `${String(shots).padStart(3, '0')}-${slug(nume)}.jpg`
      await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 72, fullPage: options.fullPage ?? false })
      return file
    },

    /** Un fragment HTML (de exemplu un email primit), randat și capturat. */
    async capturaHtml(page: Page, nume: string, html: string) {
      await page.setContent(html, { waitUntil: 'load' })
      return this.captura(page, nume, { fullPage: true })
    },

    noteaza(dovada: Omit<Dovada, 'nr' | 'capturi'> & { capturi?: string[] }) {
      items.push({ ...dovada, nr: items.length + 1, capturi: dovada.capturi ?? [] })
      return dovada.ok
    },

    abateri() {
      return items.filter(item => !item.ok && !item.cunoscut)
    },

    scrie(meta: Record<string, unknown> = {}) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'dovezi.json'), JSON.stringify({
        suite,
        generatedAt: new Date().toISOString(),
        ...meta,
        items,
      }, null, 2))
    },
  }
}

export type Dovezi = ReturnType<typeof createDovezi>

/** Emailurile primite de serverul Resend de test (tests/e2e/helpers/resend-mock.mjs). */
export type EmailCapturat = {
  at: string
  method: string
  path: string
  idempotencyKey: string | null
  body: unknown
}

export function emailuriPrimite(file = process.env.E2E_RESEND_LOG): EmailCapturat[] | null {
  if (!file || !fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as EmailCapturat)
}
