import { type Page } from '@playwright/test'

/**
 * Acțiunile unui șablon din listă stau sub „⋯” (S-30): „Editează”, „Publică”,
 * „Duplică”, „Șterge”. Ajutoarele deschid meniul rândului după nume.
 */
export type TemplateAction = 'Editează' | 'Publică' | 'Duplică' | 'Șterge'

export const templateMenu = (page: Page, name: string) =>
  page.getByRole('button', { name: `Acțiuni pentru șablonul ${name}`, exact: true })

/** Alege o acțiune; „Duplică” trece și prin confirmarea ei (S-23). */
export async function templateAction(page: Page, name: string, action: TemplateAction) {
  await templateMenu(page, name).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
  if (action === 'Duplică') {
    await page.getByRole('dialog', { name: /^Duplici șablonul/ }).getByRole('button', { name: 'Duplică' }).click()
  }
}

/** Câte acțiuni de felul ăsta are rândul: 0 sau 1. Meniul gol nu se desenează deloc. */
export async function templateHasAction(page: Page, name: string, action: TemplateAction) {
  const menu = templateMenu(page, name)
  if (await menu.count() === 0) return 0
  await menu.click()
  const count = await page.getByRole('menuitem', { name: action, exact: true }).count()
  await page.keyboard.press('Escape')
  return count
}

/**
 * Editorul de șabloane: fazele și activitățile primesc numele dintr-un dialog
 * (D9, S-27), iar acțiunile rândurilor stau sub „⋯” (S-28).
 */
export async function addEditorPhase(page: Page, name: string) {
  await page.getByRole('button', { name: 'Adaugă fază nouă' }).click()
  const dialog = page.getByRole('dialog', { name: 'Fază nouă' })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Adaugă' }).click()
  await dialog.waitFor({ state: 'detached' })
}

/** Activitate nouă în faza cu numărul `phaseIndex` (de la 0); faza se deschide singură. */
export async function addEditorActivity(page: Page, phaseIndex: number, name: string) {
  await page.getByRole('button', { name: 'Adaugă activitate' }).nth(phaseIndex).click()
  const dialog = page.getByRole('dialog', { name: 'Activitate nouă' })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Adaugă' }).click()
  await dialog.waitFor({ state: 'detached' })
}

/** O acțiune din „⋯” al unei faze, activități sau cereri din editor, după nume. */
export async function editorAction(page: Page, kind: 'faza' | 'activitatea' | 'cererea', name: string | RegExp, action: string) {
  const label = typeof name === 'string'
    ? new RegExp(`^Acțiuni pentru ${kind} ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( din faza .*)?$`)
    : name
  await page.getByRole('button', { name: label }).first().click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

/** Deschide toate fazele și activitățile din editor (la deschidere sunt strânse, S-24). */
export async function expandEditor(page: Page) {
  const all = page.getByRole('button', { name: 'Extinde toate fazele' })
  if (await all.count()) await all.click()
  for (let guard = 0; guard < 50; guard++) {
    const closed = page.getByRole('button', { name: /^Extinde (faza|activitatea) / })
    if (await closed.count() === 0) break
    await closed.first().click()
  }
}
