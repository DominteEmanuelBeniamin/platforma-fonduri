import { expect, type Locator, type Page } from '@playwright/test'

export const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

/** O zi de calendar, fără oră: an, lună (1–12), zi. */
export type Day = { y: number; m: number; d: number }

export const dayString = ({ y, m, d }: Day) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Ziua de azi în fusul dat, ca `Day`. */
export function todayIn(timeZone: string, now = new Date()): Day {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

export function addDays(day: Day, n: number): Day {
  const date = new Date(Date.UTC(day.y, day.m - 1, day.d + n))
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

/** Ziua a 15-a a lunii următoare: departe de capetele lunii și de „azi”. */
export function midNextMonth(from: Day): Day {
  return from.m === 12 ? { y: from.y + 1, m: 1, d: 15 } : { y: from.y, m: from.m + 1, d: 15 }
}

/**
 * Calendarul aplicației (`components/ui/DatePicker.tsx`, pe react-day-picker):
 * plutitor (`DatePopover`) sau sub câmp (`DateField`). Etichetele zilelor sunt
 * în română („vineri, 20 noiembrie 2026”).
 */
export class DatePickerPanel {
  readonly grid: Locator
  readonly next: Locator
  readonly previous: Locator
  readonly today: Locator
  readonly clear: Locator

  constructor(readonly page: Page, readonly root: Locator) {
    this.grid = root.getByRole('grid')
    this.next = root.getByRole('button', { name: 'Mergi la luna următoare' })
    this.previous = root.getByRole('button', { name: 'Mergi la luna anterioară' })
    this.today = root.getByRole('button', { name: 'Azi', exact: true })
    this.clear = root.getByRole('button', { name: 'Fără termen', exact: true })
  }

  /** Panoul cu numele dat (`aria-label`): „Termen limită pentru <element>”. */
  static named(page: Page, label: string) {
    return new DatePickerPanel(page, page.getByRole('dialog', { name: label, exact: true }))
  }

  async expectOpen() {
    await expect(this.grid).toBeVisible()
  }

  async goToMonth(day: Day) {
    const wanted = `${LUNI[day.m - 1]} ${day.y}`
    for (let guard = 0; guard < 120; guard++) {
      const shown = ((await this.grid.getAttribute('aria-label')) ?? '').toLowerCase()
      if (shown === wanted) return
      const [month, year] = shown.split(' ')
      const shownIndex = Number(year) * 12 + LUNI.indexOf(month)
      await (shownIndex < day.y * 12 + day.m - 1 ? this.next : this.previous).click()
    }
    await expect(this.grid).toHaveAttribute('aria-label', new RegExp(wanted, 'i'))
  }

  dayButton(day: Day) {
    return this.grid.getByRole('button', { name: new RegExp(`, ${day.d} ${LUNI[day.m - 1]} ${day.y}(, selectat)?$`) })
  }

  async pick(day: Day) {
    await this.goToMonth(day)
    await this.dayButton(day).click()
  }

  /** Panoul încape întreg în fereastră (și, dacă e dat, în containerul lui). */
  async expectInside(container?: Locator) {
    const box = (await this.root.boundingBox())!
    const viewport = this.page.viewportSize()!
    expect(box.x, 'calendarul iese pe stânga').toBeGreaterThanOrEqual(0)
    expect(box.y, 'calendarul iese pe sus').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'calendarul iese pe dreapta').toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height, 'calendarul iese pe jos').toBeLessThanOrEqual(viewport.height)
    if (container) {
      const outer = (await container.boundingBox())!
      expect(box.x, 'calendarul iese din dialog pe stânga').toBeGreaterThanOrEqual(outer.x)
      expect(box.x + box.width, 'calendarul iese din dialog pe dreapta').toBeLessThanOrEqual(outer.x + outer.width + 0.5)
    }
  }
}
