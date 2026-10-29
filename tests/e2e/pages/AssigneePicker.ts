import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Alegătorul de responsabil (`components/project-table/AssigneePicker.tsx`):
 * butonul cu inițiale și nume, panoul cu căutare, persoanele și „Fără responsabil”.
 */
export class AssigneePicker {
  readonly search: Locator
  readonly listbox: Locator
  readonly empty: Locator

  /** `trigger`: butonul alegătorului, „Atribuie consultant: <nume>”. */
  constructor(readonly page: Page, readonly trigger: Locator) {
    this.search = page.getByRole('textbox', { name: 'Caută o persoană' })
    this.listbox = page.getByRole('listbox')
    this.empty = page.getByRole('option', { name: 'Fără responsabil' })
  }

  static inside(page: Page, scope: Locator, label = 'Atribuie consultant') {
    return new AssigneePicker(page, scope.getByRole('button', { name: new RegExp(`^${label}: `) }))
  }

  async open() {
    await this.trigger.click()
    await expect(this.listbox).toBeVisible()
    await expect(this.search).toBeFocused()
  }

  option(name: string) {
    return this.listbox.getByRole('option', { name, exact: true })
  }

  async optionNames() {
    return (await this.listbox.getByRole('option').allInnerTexts()).map(text => text.trim())
  }

  /** Motivul pentru care „Fără responsabil” e blocat, legat prin `aria-describedby`. */
  async emptyReason() {
    const id = await this.empty.getAttribute('aria-describedby')
    return id ? (await this.page.locator(`[id="${id}"]`).innerText()).trim() : null
  }

  async choose(name: string) {
    await this.option(name).click()
    await expect(this.listbox).toHaveCount(0)
  }

  async expectShows(name: string) {
    await expect(this.trigger).toHaveAccessibleName(new RegExp(`: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  }
}
