import { expect, type Locator, type Page } from '@playwright/test'
import { ConfirmDialog } from './ConfirmDialog'

type Payload = { name: string; mimeType: string; buffer: Buffer }

/** Dialogul de încărcare al clientului, unul pe cerere (`ClientUploadDialog`). */
export class ClientUploadDialog {
  readonly root: Locator
  readonly choose: Locator
  readonly addMore: Locator
  readonly upload: Locator
  readonly cancel: Locator
  readonly close: Locator
  readonly files: Locator

  constructor(readonly page: Page, readonly requestName: string) {
    this.root = page.getByRole('dialog', { name: requestName, exact: true })
    this.choose = this.root.getByRole('button', { name: 'Alege fișiere', exact: true })
    this.addMore = this.root.getByRole('button', { name: 'Adaugă mai multe', exact: true })
    this.upload = this.root.getByRole('button', { name: /^Încarcă( \(\d+\))?$/ })
    this.cancel = this.root.getByRole('button', { name: 'Anulează', exact: true })
    this.close = this.root.getByRole('button', { name: 'Închide', exact: true })
    this.files = this.root.getByRole('list', { name: 'Fișierele alese' })
  }

  /** Butonul de sub rândul cererii care deschide dialogul. */
  static opener(page: Page, requestId: string) {
    return page.locator(`#request-${requestId}`).getByRole('button', { name: /^(Încarcă|Reîncarcă) fișiere$/ })
  }

  async expectOpen() {
    await expect(this.root).toBeVisible()
  }

  /** Alege fișierele prin selectorul sistemului, deschis de un clic real pe buton. */
  async pick(button: Locator, files: Payload[]) {
    const chooser = this.page.waitForEvent('filechooser')
    await button.click()
    await (await chooser).setFiles(files)
  }

  discardDialog() {
    return new ConfirmDialog(this.page, 'Renunți la fișierele alese?')
  }
}
