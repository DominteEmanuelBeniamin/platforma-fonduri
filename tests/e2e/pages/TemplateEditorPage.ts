import { expect, type Locator, type Page } from '@playwright/test'
import { ConfirmDialog } from './ConfirmDialog'
import { escapeRegExp } from './TemplatesListPage'

export type EditorKind = 'faza' | 'activitatea' | 'cererea'

export type EditorTree = { name: string; activities: { name: string; docs: string[] }[] }[]

/**
 * Editorul de șabloane: numele se schimbă din dialog (D9), acțiunile
 * rândurilor stau sub „⋯” (S-28), iar bara de salvare e lipită jos.
 */
export class TemplateEditorPage {
  readonly heading: Locator
  readonly name: Locator
  readonly nameField: Locator
  readonly description: Locator
  readonly expandAll: Locator
  readonly collapseAll: Locator
  readonly addPhase: Locator
  readonly save: Locator
  readonly cancel: Locator
  readonly saveBar: Locator
  readonly phasesSection: Locator

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1, name: /^(Editează șablonul|Șablon nou)$/ })
    this.name = page.getByPlaceholder('Ex: Proiect Standard')
    // Câmpul cu eticheta lui: mesajul de eroare stă în aceeași etichetă, sub input.
    this.nameField = page.locator('label').filter({ has: this.name })
    this.description = page.getByPlaceholder('Descriere scurtă…')
    this.expandAll = page.getByRole('button', { name: 'Extinde toate fazele', exact: true })
    this.collapseAll = page.getByRole('button', { name: 'Restrânge toate fazele', exact: true })
    this.addPhase = page.getByRole('button', { name: 'Adaugă fază nouă', exact: true })
    this.save = page.getByRole('button', { name: /^(Salvează modificările|Creează template)$/ })
    this.cancel = page.getByRole('button', { name: 'Anulează', exact: true })
    this.saveBar = this.save.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " sticky ")][1]')
    this.phasesSection = page.locator('section[aria-labelledby="faze-sablon"]')
  }

  async expectOpen() {
    await expect(this.heading).toBeVisible()
  }

  menuButton(kind: EditorKind, name: string) {
    const suffix = kind === 'activitatea' ? '( din faza .*)?' : ''
    return this.page.getByRole('button', { name: new RegExp(`^Acțiuni pentru ${kind} ${escapeRegExp(name)}${suffix}$`) })
  }

  async action(kind: EditorKind, name: string, action: string) {
    await this.menuButton(kind, name).first().click()
    await this.page.getByRole('menu').getByRole('menuitem', { name: action, exact: true }).click()
  }

  async menuItems(kind: EditorKind, name: string) {
    await this.menuButton(kind, name).first().click()
    const menu = this.page.getByRole('menu')
    const items = (await menu.getByRole('menuitem').allInnerTexts()).map(t => t.trim())
    await this.page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    return items
  }

  phaseToggles() {
    return this.page.getByRole('button', { name: /^(Extinde|Restrânge) faza / })
  }

  /** Antetul unei faze: rândul cu mânerul, săgeata, numărul, titlul și „⋯”. */
  phaseHeader(name: string) {
    return this.menuButton('faza', name).locator('xpath=ancestor::div[.//span[@draggable="true"]][1]')
  }

  activityHeader(name: string) {
    return this.menuButton('activitatea', name).locator('xpath=ancestor::div[.//span[@draggable="true"]][1]')
  }

  /** Mânerul de tras al unei faze sau al unei activități. */
  dragHandle(header: Locator) {
    return header.locator('span[draggable="true"]').first()
  }

  /** Dialogul de nume: „Fază nouă”, „Activitate nouă”, „Redenumește faza/activitatea”. */
  nameDialog(title: string) {
    return this.page.getByRole('dialog', { name: title })
  }

  async addPhaseNamed(name: string) {
    await this.addPhase.click()
    const dialog = this.nameDialog('Fază nouă')
    await dialog.getByRole('textbox').fill(name)
    await dialog.getByRole('button', { name: 'Adaugă', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }

  async rename(kind: 'faza' | 'activitatea', from: string, to: string) {
    await this.action(kind, from, 'Redenumește')
    const dialog = this.nameDialog(kind === 'faza' ? 'Redenumește faza' : 'Redenumește activitatea')
    await expect(dialog.getByRole('textbox')).toHaveValue(from)
    await dialog.getByRole('textbox').fill(to)
    await dialog.getByRole('button', { name: 'Salvează', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }

  /** O cerere nouă în activitatea dată, din dialogul cererii. */
  async addDoc(activityName: string, docName: string) {
    const activity = this.activityBlock(activityName)
    await activity.getByRole('button', { name: 'Adaugă cerere document', exact: true }).click()
    const dialog = this.page.getByRole('dialog', { name: 'Adaugă cerere document' })
    await dialog.getByPlaceholder('Ex: Certificat constatator').fill(docName)
    await dialog.getByRole('button', { name: 'Adaugă', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }

  /** Blocul unei activități: antetul ei și lista de cereri de dedesubt. */
  activityBlock(name: string) {
    return this.activityHeader(name).locator('xpath=..')
  }

  /** Deschide toate fazele și activitățile (la deschidere sunt strânse, S-24). */
  async expandEverything() {
    if (await this.expandAll.isVisible()) await this.expandAll.click()
    const closed = this.page.getByRole('button', { name: /^Extinde (faza|activitatea) / })
    while (await closed.count() > 0) await closed.first().click()
    await expect(closed).toHaveCount(0)
  }

  /**
   * Arborele de pe ecran, citit în ordinea din pagină din numele „⋯”-urilor:
   * faza, activitățile ei („… din faza X”), cererile fiecărei activități.
   * Cere ca totul să fie desfăcut.
   */
  async screenTree(): Promise<EditorTree> {
    const labels = await this.phasesSection.getByRole('button', { name: /^Acțiuni pentru / }).evaluateAll(
      buttons => buttons.map(b => b.getAttribute('aria-label') ?? ''),
    )
    const tree: EditorTree = []
    for (const label of labels) {
      const phase = /^Acțiuni pentru faza (.*)$/.exec(label)
      if (phase) { tree.push({ name: phase[1], activities: [] }); continue }
      const activity = /^Acțiuni pentru activitatea (.*) din faza (.*)$/.exec(label)
      if (activity) { tree[tree.length - 1].activities.push({ name: activity[1], docs: [] }); continue }
      const doc = /^Acțiuni pentru cererea (.*)$/.exec(label)
      if (doc) {
        const activities = tree[tree.length - 1].activities
        activities[activities.length - 1].docs.push(doc[1])
      }
    }
    return tree
  }

  discardDialog() {
    return new ConfirmDialog(this.page, 'Renunți la modificări?')
  }
}
