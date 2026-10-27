import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Confirmarea aplicației (`confirm` din `app/providers/ToastProvider.tsx`):
 * un dialog cu titlul întrebării, „Anulează” și butonul de confirmare.
 */
export class ConfirmDialog {
  readonly root: Locator

  constructor(readonly page: Page, title: string | RegExp) {
    this.root = page.getByRole('dialog', { name: title })
  }

  async expectOpen(description?: string) {
    await expect(this.root).toBeVisible()
    if (description) await expect(this.root.getByText(description, { exact: true })).toBeVisible()
  }

  async confirm(label: string) {
    await this.root.getByRole('button', { name: label, exact: true }).click()
    await expect(this.root).toHaveCount(0)
  }

  async cancel() {
    await this.root.getByRole('button', { name: 'Anulează', exact: true }).click()
    await expect(this.root).toHaveCount(0)
  }
}

/**
 * Confirmarea cu cuvânt de tastat (`ConfirmDeleteModal`): publicarea unui
 * șablon cere „aproba”, ștergerea „sterge”.
 */
export async function confirmWithWord(page: Page, button: RegExp) {
  const dialog = page.getByRole('dialog').filter({ has: page.locator('input[placeholder]') })
  const input = dialog.locator('input[placeholder]')
  await input.fill(await input.getAttribute('placeholder') ?? '')
  await dialog.getByRole('button', { name: button }).last().click()
  await expect(dialog).toHaveCount(0)
}
