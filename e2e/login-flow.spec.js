const { expect, test } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3002';

test.describe('admin login flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${baseURL}/admin-login.html`);
  });

  test('shows validation when username and password are empty', async ({ page }) => {
    let loginRequested = false;
    await page.route('**/api/admin/login', async (route) => {
      loginRequested = true;
      await route.continue();
    });

    await page.locator('#btn-login').click();

    await expect(page.locator('#error-msg')).toBeVisible();
    await expect(page.locator('#error-msg')).toContainText('Please enter your username and password.');
    await expect(page.locator('#username')).toHaveClass(/error/);
    await expect(page.locator('#password')).toHaveClass(/error/);
    expect(loginRequested).toBe(false);
  });

  test('shows an error and clears the password when credentials are rejected', async ({ page }) => {
    await page.route('**/api/admin/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Incorrect username or password.' }),
      });
    });

    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('incorrect-password');
    await page.locator('#btn-login').click();

    await expect(page.locator('#error-msg')).toBeVisible();
    await expect(page.locator('#error-msg')).toContainText('Incorrect username or password.');
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#btn-login')).toBeEnabled();
  });

  test('stores the admin session and redirects after successful login', async ({ page }) => {
    let loginRequest;
    await page.route('**/api/admin/login', async (route) => {
      loginRequest = route.request();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          username: 'admin',
          display_name: 'News Admin',
        }),
      });
    });

    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('correct-password');
    await page.locator('#btn-login').click();

    await page.waitForURL('**/upload.html');
    expect(loginRequest.postDataJSON()).toEqual({
      username: 'admin',
      password: 'correct-password',
    });
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('isAdmin')))
      .toBe('true');
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('adminUser')))
      .toBe('admin');
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('adminDisplayName')))
      .toBe('News Admin');
  });
});
