import { expect, type Locator, type Page } from '@playwright/test'

export class LoginPage {
  readonly email: Locator
  readonly password: Locator
  readonly submit: Locator
  /** Apare numai pentru un utilizator autentificat. */
  readonly signedInNavigation: Locator

  constructor(readonly page: Page) {
    this.email = page.getByLabel('Email', { exact: true })
    this.password = page.getByLabel('Parolă', { exact: true })
    this.submit = page.getByRole('button', { name: 'Intră în cont', exact: true })
    this.signedInNavigation = page.getByRole('navigation', { name: 'Navigare principală' })
  }

  /**
   * În build-ul de producție, un formular completat înainte de hidratare se
   * golește. Cererea de disponibilitate a recovery-ului pleacă după hidratare,
   * deci după ea câmpurile nu mai sunt resetate.
   */
  async goto() {
    const hydrated = this.page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/recovery/availability')
    await this.page.goto('/login')
    await hydrated
    await expect(this.submit).toBeEnabled()
  }

  async login(email: string, password: string) {
    await this.goto()
    await this.email.fill(email)
    await this.password.fill(password)
    await expect(this.email).toHaveValue(email)
    await expect(this.password).toHaveValue(password)
    await this.submit.click()
    await expect(this.page).toHaveURL(url => url.pathname === '/')
    await expect(this.signedInNavigation).toBeVisible()
  }
}
