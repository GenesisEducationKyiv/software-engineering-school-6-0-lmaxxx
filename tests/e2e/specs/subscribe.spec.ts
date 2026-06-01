import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows success message after valid submission', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'owner/repo');
  await page.click('#submit-btn');

  const msg = page.locator('#message');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveClass(/success/);
  await expect(msg).toContainText('Check your email');
});

test('shows error message when repository does not exist', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'notfound/repo');
  await page.click('#submit-btn');

  const msg = page.locator('#message');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveClass(/error/);
});

test('does not submit when email is empty (HTML5 validation)', async ({ page }) => {
  await page.fill('#repo', 'owner/repo');
  await page.click('#submit-btn');

  await expect(page.locator('#message')).toBeHidden();
});

test('disables submit button during request and re-enables on completion', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'owner/repo');

  const btn = page.locator('#submit-btn');

  await page.route('/api/subscribe', async (route) => {
    await route.continue();
  });

  await btn.click();
  await expect(btn).toBeDisabled();
  await expect(btn).toBeEnabled();
});

test('shows error message for invalid repo format', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'no-slash-here');
  await page.click('#submit-btn');

  const msg = page.locator('#message');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveClass(/error/);
});

test('shows error message when GitHub rate limit is exceeded', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'ratelimited/repo');
  await page.click('#submit-btn');

  const msg = page.locator('#message');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveClass(/error/);
});

test('subscribes successfully to a repo that has no releases yet', async ({ page }) => {
  await page.fill('#email', 'user@example.com');
  await page.fill('#repo', 'owner/noreleases');
  await page.click('#submit-btn');

  const msg = page.locator('#message');
  await expect(msg).toBeVisible();
  await expect(msg).toHaveClass(/success/);
  await expect(msg).toContainText('Check your email');
});
