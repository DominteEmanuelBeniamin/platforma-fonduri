// Unelte comune pentru ghidul de utilizare: login rapid pe conturile demo
// locale, capturi cu evidențierea elementului de apăsat și subtitrări în video.
// Rulează DOAR pe Supabase-ul local cu datele din `npm run seed:local`.
import nextEnv from '@next/env'
import { createClient } from '@supabase/supabase-js'
import { assertDemoStack, eDemo } from '../demo/tinta.mjs'

nextEnv.loadEnvConfig(process.cwd())
export const APP = process.env.GHID_APP_URL || 'http://localhost:3000'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
// Excepție: datele ghidului pe proiectul demo, prin scripts/demo/populeaza.mjs.
if (eDemo(process.env)) assertDemoStack(process.env)
else if (!SUPABASE_URL || !['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error('Ghidul se generează doar pe Supabase-ul local.')
}
export const PAROLA = 'ParolaDemo123!'
export const CONTURI = {
  admin: 'admin@test.local',
  senior: 'mihai.ionescu@test.local',
  junior: 'ana.popescu@test.local',
  client: 'client.agroverde@test.local',
}

export const service = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/** Sesiune nouă pentru fiecare context: refresh token-urile sunt de unică folosință. */
export async function sesiune(email) {
  const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PAROLA })
  if (error) throw error
  return data.session
}

export async function context(browser, rol, opts = {}) {
  const email = CONTURI[rol] || rol
  const s = await sesiune(email)
  const ctx = await browser.newContext({
    baseURL: APP, locale: 'ro-RO', timezoneId: 'Europe/Bucharest',
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts,
  })
  await ctx.addInitScript(([key, value]) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value)
  }, ['sb-127-auth-token', JSON.stringify(s)])
  return ctx
}

/** Așteaptă să se liniștească pagina: rețea + spinnere „Se încarcă”. */
export async function linistit(page, ms = 400) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForFunction(() => !/Se încarcă/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

/**
 * Pune un chenar peste elementele date (ca în ghidurile tipărite) și, opțional,
 * o etichetă numerotată. Se scoate cu `curata`.
 */
export async function evidentiaza(page, locators, { eticheta } = {}) {
  // Derulăm o singură dată, la primul element; altfel chenarele măsurate
  // înainte de o derulare ulterioară ajung lângă elementele lor.
  const locs = [].concat(locators).map(l => (l.first ? l.first() : l))
  await locs[0]?.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(150)
  const boxes = []
  for (const loc of locs) {
    const b = await loc.boundingBox().catch(() => null)
    if (b) boxes.push(b)
  }
  await page.evaluate(({ boxes, eticheta }) => {
    boxes.forEach((b, i) => {
      const d = document.createElement('div')
      d.className = '__ghid-marcaj'
      Object.assign(d.style, {
        position: 'fixed', left: `${b.x - 5}px`, top: `${b.y - 5}px`, width: `${b.width + 10}px`, height: `${b.height + 10}px`,
        border: '3px solid #E8590C', borderRadius: '6px', boxShadow: '0 0 0 4px rgba(232,89,12,.22)', zIndex: 2147483646, pointerEvents: 'none',
      })
      document.body.appendChild(d)
      const text = Array.isArray(eticheta) ? eticheta[i] : (i === 0 ? eticheta : null)
      if (text) {
        const t = document.createElement('div')
        t.className = '__ghid-marcaj'
        t.textContent = text
        // Cifrele stau în stânga chenarului, ca să nu acopere eticheta câmpului;
        // textele lungi stau deasupra (sau dedesubt, lângă marginea de sus).
        const scurt = text.length <= 3 && b.x > 48
        Object.assign(t.style, {
          position: 'fixed',
          left: `${scurt ? b.x - 42 : Math.max(4, b.x - 5)}px`,
          top: `${scurt ? b.y + b.height / 2 - 14 : b.y > 40 ? b.y - 36 : b.y + b.height + 10}px`,
          background: '#E8590C', color: '#fff', font: '700 14px/1 system-ui, sans-serif', padding: '6px 9px', borderRadius: '4px',
          zIndex: 2147483647, pointerEvents: 'none', whiteSpace: 'nowrap',
        })
        document.body.appendChild(t)
      }
    })
  }, { boxes, eticheta })
}

export async function curata(page) {
  await page.evaluate(() => document.querySelectorAll('.__ghid-marcaj').forEach(e => e.remove())).catch(() => {})
}

/** Ascunde tooltipurile și cursorul de text, ca să nu apară la întâmplare în capturi. */
export async function fixeazaAspect(page) {
  await page.addStyleTag({ content: '#sg-tooltip{display:none!important} *{caret-color:transparent!important}' }).catch(() => {})
}
