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
