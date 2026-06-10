import { expect, test } from '@playwright/test'

/**
 * Smoke test: login → dashboard → keyword-research tool → submit a keyword.
 *
 * Requires E2E_EMAIL and E2E_PASSWORD (and optionally E2E_BASE_URL,
 * default http://localhost:3000). The whole suite is skipped when
 * credentials are not provided.
 *
 * The keyword-research tool needs a Keywords Everywhere API key server-side;
 * either a results table OR a visible error message proves the route and
 * submission flow work, so both outcomes pass.
 */
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD

test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL / E2E_PASSWORD not set — skipping smoke suite')

test('login, select client, run keyword research', async ({ page }) => {
  // ── Login ──────────────────────────────────────────────────────────────
  await page.goto('/login')
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL!)
  await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD!)
  await page.getByRole('button', { name: /sign in|log in|login/i }).first().click()

  // Wait until we leave /login (dashboard shell rendered)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  await expect(page.locator('nav, aside').first()).toBeVisible({ timeout: 15_000 })

  // ── Select a client if a client switcher is present (admin/member) ─────
  const switcher = page
    .locator('select, [role="combobox"], button:has-text("Select client"), button:has-text("Select a client")')
    .first()
  if (await switcher.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const tag = await switcher.evaluate((el) => el.tagName.toLowerCase())
    if (tag === 'select') {
      const options = await switcher.locator('option').all()
      if (options.length > 1) {
        const value = await options[1].getAttribute('value')
        if (value) await switcher.selectOption(value)
      }
    } else {
      await switcher.click()
      const option = page.locator('[role="option"], [role="menuitem"], li').first()
      if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await option.click()
      }
    }
  }

  // ── Keyword research tool ──────────────────────────────────────────────
  await page.goto('/tools/keyword-research')
  await expect(page).toHaveURL(/keyword-research/)

  const input = page.locator('textarea, input[type="text"], input[type="search"]').first()
  await expect(input).toBeVisible({ timeout: 15_000 })
  await input.fill('plumber near me')

  await page
    .getByRole('button', { name: /research|run|search|submit|get/i })
    .first()
    .click()

  // Either a results table or an error message proves the route works.
  const outcome = page.locator('table, [role="table"], [role="alert"], .text-red-400, .text-red-500')
  await expect(outcome.first()).toBeVisible({ timeout: 60_000 })
})
