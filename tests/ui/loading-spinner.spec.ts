import { test, expect } from '@playwright/test'

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`loading indicators keep rotating with motion preference ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.route('**/api/**', route => route.fulfill({ json: { available: false } }))
    await page.goto('/login')
    await page.evaluate(() => {
      const spinner = document.createElement('span')
      spinner.id = 'loading-motion-check'
      spinner.className = 'block h-10 w-10 animate-spin rounded-full border-4 border-t-transparent'
      document.body.append(spinner)
    })
    const spinner = page.locator('#loading-motion-check')
    await expect.poll(() => spinner.evaluate(el => getComputedStyle(el).animationName)).toBe('spin')
    expect(await spinner.evaluate(el => getComputedStyle(el).animationIterationCount)).toBe('infinite')
    const initial = await spinner.evaluate(el => getComputedStyle(el).transform)
    await expect.poll(() => spinner.evaluate(el => getComputedStyle(el).transform)).not.toBe(initial)
    if (reducedMotion === 'reduce') {
      expect(await spinner.evaluate(el => getComputedStyle(el).animationDuration)).toBe('2s')
    }
  })
}
