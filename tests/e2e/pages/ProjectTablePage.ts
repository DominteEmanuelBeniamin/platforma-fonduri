import { expect, type Locator, type Page } from '@playwright/test'

export const ACTIVITY_LABELS = /^(Finalizată|Depășită|Document respins|De verificat|La client|Toate primite|În curs|De încărcat|În verificare)$/

/** Pagina proiectului, vederea „Faze & Activități” ca tabel. */
export class ProjectTablePage {
  readonly viewSwitch: Locator
  readonly collapseAll: Locator
  readonly expandAll: Locator
  readonly showAll: Locator
  readonly showFinal: Locator
  readonly sidebar: Locator
  readonly collapseSidebar: Locator
  readonly openSidebar: Locator
  readonly tableContainer: Locator

  constructor(readonly page: Page) {
    this.viewSwitch = page.getByRole('group', { name: 'Vederea fazelor' })
    this.collapseAll = page.getByRole('button', { name: 'Restrânge toate grupurile', exact: true })
    this.expandAll = page.getByRole('button', { name: 'Extinde toate grupurile', exact: true })
    this.showAll = page.getByRole('button', { name: 'Arată toate fazele', exact: true })
    this.showFinal = page.getByRole('checkbox', { name: /^Arată și ce e finalizat/ })
    this.sidebar = page.locator('aside')
    this.collapseSidebar = page.getByRole('button', { name: 'Strânge panoul fazelor', exact: true })
    this.openSidebar = page.getByRole('button', { name: 'Arată panoul fazelor', exact: true })
    // Învelișul `@container` după care tabelul își alege forma.
    this.tableContainer = page.locator('main .\\@container')
  }

  async goto(projectId: string, query = '') {
    await this.page.goto(`/projects/${projectId}${query}`)
    await expect(this.viewSwitch).toBeVisible()
  }

  /** Grupul unei faze (sau „Cereri generale”, „Documente trimise clientului”): o regiune cu titlul ei. */
  group(title: string) {
    return this.page.getByRole('region', { name: title, exact: true })
  }

  groupTitles() {
    return this.page.locator('main section[id^="phase-"] h2').allInnerTexts()
  }

  activity(id: string) {
    return this.page.locator(`#activity-${id}`)
  }

  /** Rândul propriu-zis al activității, fără cererile desfăcute dedesubt. */
  activityLine(id: string) {
    return this.activity(id).locator(':scope > div').first()
  }

  activityStatus(id: string) {
    return this.activityLine(id).getByText(ACTIVITY_LABELS)
  }

  async toggleActivity(id: string, name: string) {
    await this.activity(id).getByRole('button', { name: new RegExp(`^(Extinde|Restrânge) activitatea ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).click()
  }

  async expandActivity(id: string, name: string) {
    const button = this.activity(id).getByRole('button', { name: `Extinde activitatea ${name}`, exact: true })
    await button.click()
    await expect(this.activity(id).getByRole('button', { name: `Restrânge activitatea ${name}`, exact: true })).toBeVisible()
  }

  request(id: string) {
    return this.page.locator(`#request-${id}`)
  }

  /** Antetul de coloane al unui grup: etichetele, în ordinea de pe ecran (de la stânga la dreapta). */
  async headerLabels(group: Locator) {
    const header = group.locator('div[aria-hidden="true"]').filter({ hasText: 'Responsabil' }).first()
    return orderedTexts(header.locator(':scope > span'))
  }

  /** Antetul sub-tabelului de cereri al unei activități. */
  async requestHeaderLabels(activity: Locator) {
    const header = activity.locator('div[aria-hidden="true"]').filter({ hasText: 'Cerere' }).first()
    return orderedTexts(header.locator(':scope > span'))
  }

  /** Rândul de sumar al grupului și eticheta lui „Total”. */
  summaryLabel(group: Locator) {
    return group.getByText(/^Total:?$/)
  }

  summary(group: Locator) {
    return this.summaryLabel(group).locator('xpath=..')
  }

  sidebarPhase(name: string) {
    return this.sidebar.locator('[data-tooltip-side="right"]').filter({ hasText: name }).first()
  }

  /** „⋯” din tabel; panoul fazelor are aceleași nume, dar nu stă în grupurile tabelului. */
  actionMenu(label: string) {
    return this.page.locator('section[id^="phase-"]').getByRole('button', { name: label, exact: true })
  }

  async chooseFromMenu(label: string, item: string) {
    await this.actionMenu(label).click()
    await this.page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click()
  }
}

/** Textele vizibile, sortate după poziția pe orizontală. */
export async function orderedTexts(items: Locator) {
  const boxes = await Promise.all((await items.all()).map(async item => ({ text: (await item.innerText()).trim(), box: await item.boundingBox() })))
  return boxes.filter(b => b.box && b.box.width > 0).sort((a, b) => a.box!.x - b.box!.x).map(b => b.text)
}
