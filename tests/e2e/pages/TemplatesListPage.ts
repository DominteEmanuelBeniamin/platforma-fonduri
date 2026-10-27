import { expect, type Locator, type Page } from '@playwright/test'
import { ConfirmDialog, confirmWithWord } from './ConfirmDialog'

export type TemplateAction = 'Editează' | 'Publică' | 'Duplică' | 'Șterge'

/** Lista de șabloane (`/admin/templates`), fără editor deschis. */
export class TemplatesListPage {
  readonly heading: Locator
  readonly newTemplate: Locator
  readonly search: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: 'Șabloane', exact: true })
    this.newTemplate = page.getByRole('button', { name: 'Șablon nou', exact: true })
    this.search = page.getByRole('searchbox', { name: 'Caută șabloane' }).or(page.getByLabel('Caută șabloane'))
  }

  async goto() {
    await this.page.goto('/admin/templates')
    await expect(this.heading).toBeVisible()
  }

  /** Rândul unui șablon: cel care are „⋯”-ul cu numele lui. */
  row(name: string) {
    return this.page.locator('tbody tr').filter({ has: this.menuButton(name) })
  }

  menuButton(name: string) {
    return this.page.getByRole('button', { name: `Acțiuni pentru șablonul ${name}`, exact: true })
  }

  /** Numele accesibile ale tuturor butoanelor din rând, în ordine. */
  async rowButtons(name: string) {
    const buttons = await this.row(name).getByRole('button').all()
    return Promise.all(buttons.map(async b => (await b.getAttribute('aria-label')) ?? (await b.innerText()).trim()))
  }

  async openMenu(name: string) {
    await this.menuButton(name).click()
    const menu = this.page.getByRole('menu')
    await expect(menu).toBeVisible()
    return menu
  }

  async menuItems(name: string) {
    const menu = await this.openMenu(name)
    const items = await menu.getByRole('menuitem').allInnerTexts()
    await this.page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    return items.map(item => item.trim())
  }

  async action(name: string, action: TemplateAction) {
    const menu = await this.openMenu(name)
    await menu.getByRole('menuitem', { name: action, exact: true }).click()
  }

  duplicateDialog(name: string) {
    return new ConfirmDialog(this.page, `Duplici șablonul «${name}»?`)
  }

  async publish(name: string) {
    await this.action(name, 'Publică')
    await confirmWithWord(this.page, /^Aprobă/)
  }

  /** Eticheta Ciornă/Publicat din rând, cu învelișul care poartă tooltip-ul. */
  statusBadge(name: string) {
    return this.row(name).locator('[data-tooltip]').filter({ hasText: /^(Ciornă|Publicat)$/ })
  }

  expandButton(name: string) {
    return this.page.getByRole('button', { name: new RegExp(`^(Arată|Ascunde) fazele — ${escapeRegExp(name)}$`) })
  }

  /** Lista fazelor unui șablon desfăcut (rândul de detalii are id-ul șablonului). */
  phaseItems(templateId: string) {
    return this.page.locator(`#faze-template-${templateId} ol > li`)
  }
}

export function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
