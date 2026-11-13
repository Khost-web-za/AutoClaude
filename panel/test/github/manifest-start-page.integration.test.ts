import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { handleManifestStart } from '@/github/callback-handlers';
import { withGithub } from './github-fixtures';

describe('manifest start page in a real browser', () => {
  it('submits the full manifest (decoded) to GitHub and does not auto-submit', async () => {
    await withGithub(async (ctx) => {
      const html = await handleManifestStart({ organization: 'my-org', ownerHint: 'k' }, ctx.deps).text();
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const posts: string[] = [];
        await page.route('**/*', (route) => {
          if (route.request().method() === 'POST') posts.push(route.request().postData() ?? '');
          return route.abort();
        });
        await page.setContent(html);
        // Nothing leaves the page until "Continue to GitHub" is pressed.
        expect(posts).toEqual([]);

        const manifest = JSON.parse(await page.locator('input[name=manifest]').inputValue());
        expect(manifest).toMatchObject({ url: 'https://claude.example.com', hook_attributes: { active: false } });
        expect(await page.locator('form').getAttribute('action')).toContain(
          `${ctx.stub.url}/organizations/my-org/settings/apps/new?state=`,
        );

        await page.getByRole('button', { name: 'Continue to GitHub' }).click();
        await expect.poll(() => posts.length).toBe(1);
        const sent = new URLSearchParams(posts[0]);
        expect(JSON.parse(sent.get('manifest') ?? '{}').url).toBe('https://claude.example.com');
      } finally {
        await browser.close();
      }
    });
  }, 60_000);
});
