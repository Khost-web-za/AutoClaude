import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { expect, request, test, type Page } from '@playwright/test';
import { importPKCS8, SignJWT } from 'jose';

/**
 * The main flow against the e2e stack (docker-compose.e2e.yml): Access gate, first-run checklist,
 * GitHub App + installation (through the stub), New session → live Starting → Working, the Remote
 * Control link, Stop, Delete with the typed-name guard, and no container left behind.
 * Expects a fresh stack (it sets up the GitHub App itself): `down -v` before running it again.
 */

const STUB_URL = process.env.E2E_STUB_URL ?? 'http://127.0.0.1:3311';
const TEAM_DOMAIN = 'e2e.cloudflareaccess.com';
const AUDIENCE = 'claudecloud-e2e';
const REPO = 'e2e-owner/hello-world';
const STUB_RC_URL = 'https://claude.ai/code/session_stub123';

/** A Cloudflare Access token signed with the stub's key. Mixed case: the panel matches emails case-insensitively. */
async function accessToken(): Promise<string> {
  const response = await fetch(`${STUB_URL}/test/access-key`);
  if (!response.ok) throw new Error(`stub access key: HTTP ${response.status}`);
  const { kid, pem } = (await response.json()) as { kid: string; pem: string };
  return new SignJWT({ email: 'Owner@Example.com' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await importPKCS8(pem, 'RS256'));
}

function sessionContainers(sessionId: string): string {
  return execFileSync('docker', ['ps', '-a', '--filter', `label=claudecloud.session=${sessionId}`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).trim();
}

const sessionRow = (page: Page) => page.getByRole('row', { name: new RegExp(REPO) });

test('smoke: access, setup, start, live status, stop, delete', async ({ page, context, baseURL }) => {
  await test.step('without an Access token every page is 403', async () => {
    const anonymous = await request.newContext({ baseURL });
    expect((await anonymous.get('/')).status()).toBe(403);
    expect((await anonymous.get('/sessions/new')).status()).toBe(403);
    expect((await anonymous.get('/api/health')).status()).toBe(200);
    await anonymous.dispose();
  });

  await context.setExtraHTTPHeaders({ 'cf-access-jwt-assertion': await accessToken() });

  await test.step('with a token, Sessions shows the setup checklist', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
  });

  await test.step('connect a GitHub App and record its installation (GitHub is the stub)', async () => {
    await page.goto('/connections/github');
    const appKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    await page.getByLabel('App ID').fill('4242');
    await page.getByLabel('App slug').fill('claudecloud-e2e');
    await page.getByLabel('Client ID').fill('Iv23e2eclient');
    await page.getByLabel('Client secret').fill('e2e-client-secret');
    await page.getByLabel('Private key').fill(appKey.toString());
    await page.getByRole('button', { name: 'Save App' }).click();
    await expect(page.getByText('Not installed anywhere yet', { exact: false })).toBeVisible();

    // GitHub's post-install redirect; the panel confirms the id against the (stub) API.
    await page.goto('/api/github/setup?installation_id=777');
    await expect(page).toHaveURL(/\/connections\/github\?installed=1/);
    await expect(page.getByRole('link', { name: 'Manage the installation on e2e-owner' })).toBeVisible();
  });

  // A second tab on Sessions (still the checklist: Claude is not connected) must pick the session up live.
  const watcher = await context.newPage();
  await watcher.goto('/');
  await expect(watcher.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();

  let sessionId = '';
  await test.step('New session: repo, example profile, starting task, Start', async () => {
    await page.goto('/sessions/new');
    const repoBox = page.getByRole('combobox', { name: 'Repository' });
    await repoBox.click();
    await repoBox.fill('hello');
    await page.getByRole('option', { name: REPO }).click();
    await expect(page.getByRole('combobox', { name: 'Base branch' })).toHaveValue('main');
    await page.getByText('example', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /^example/ })).toBeChecked();
    await page.getByRole('textbox', { name: /Starting task/ }).fill('say hi 👋');
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.waitForURL(/\/sessions\/[0-9a-f-]{36}$/);
    sessionId = /\/sessions\/([0-9a-f-]{36})$/.exec(page.url())![1]!;
  });

  await test.step('the row appears Starting, then Working, without a reload', async () => {
    const row = sessionRow(watcher);
    await expect(row).toBeVisible();
    await expect(row.getByText('Starting', { exact: true })).toBeVisible();
    await expect(row.getByText('Working', { exact: true })).toBeVisible({ timeout: 120_000 });
  });

  await test.step('detail shows the Remote Control link the runner reported', async () => {
    const status = page.locator('span[aria-live="polite"]').first();
    await expect(status).toContainText('Working');
    const open = page.getByRole('link', { name: 'Open in Claude' }).filter({ visible: true }).first();
    await expect(open).toHaveAttribute('href', STUB_RC_URL);
  });

  await test.step('Stop', async () => {
    await page.getByRole('button', { name: /^Stop/ }).filter({ visible: true }).first().click();
    await expect(page.locator('span[aria-live="polite"]').first()).toContainText('Stopped', { timeout: 60_000 });
  });

  await test.step('Delete: unverifiable work needs the repository name typed', async () => {
    await page.getByRole('button', { name: 'Delete…' }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/would be lost/)).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Delete session' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('textbox').fill(REPO);
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await page.waitForURL((url) => url.pathname === '/');
    await expect(sessionRow(page)).toHaveCount(0);
  });

  await test.step('no session container is left', async () => {
    await expect.poll(() => sessionContainers(sessionId), { timeout: 30_000 }).toBe('');
  });
});
