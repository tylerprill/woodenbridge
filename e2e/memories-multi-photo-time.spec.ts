import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { monitorBrowserIssues } from './support/ui-audit';

const fixtureRoot = path.join(
  process.cwd(),
  'output/uiux-image-upload/test-images',
);
const photoFiles = [
  path.join(fixtureRoot, 'riverwalk-test.png'),
  path.join(fixtureRoot, 'kyoto-test.png'),
];

async function signIn(page: Page) {
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Memories smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  label: string,
  fullPage = true,
) {
  const screenshotPath = testInfo.outputPath(`${label}.png`);
  await page.screenshot({
    path: screenshotPath,
    fullPage,
    animations: 'disabled',
  });
  await testInfo.attach(label, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

async function expectEditorFits(page: Page, label: string) {
  const metrics = await page
    .getByRole('dialog', { name: /(?:Create|Edit) memory/ })
    .evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        bodyOverflow: document.documentElement.scrollWidth - window.innerWidth,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
  expect
    .soft(metrics.bodyOverflow, `${label}: horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(metrics.left, `${label}: editor left edge`)
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(metrics.top, `${label}: editor top edge`)
    .toBeGreaterThanOrEqual(0);
  expect
    .soft(metrics.right, `${label}: editor right edge`)
    .toBeLessThanOrEqual(metrics.viewportWidth);
  expect
    .soft(metrics.bottom, `${label}: editor bottom edge`)
    .toBeLessThanOrEqual(metrics.viewportHeight);
}

async function auditMemoriesList(
  page: Page,
  testInfo: TestInfo,
  label: string,
  title: string,
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const card = page
    .getByRole('region', { name: 'Memories' })
    .getByRole('link', { name: new RegExp(`Open ${title}`) });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const cardImages = card.locator('xpath=ancestor::article').locator('img');
  await expect(cardImages).toHaveCount(1);
  await expect
    .poll(async () =>
      cardImages.evaluateAll((images) =>
        images.every(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  const imageSource = await cardImages.getAttribute('src');
  expect(imageSource).toBeTruthy();
  expect(
    (
      await page.context().request.get(new URL(imageSource!, page.url()).href)
    ).status(),
  ).toBe(200);

  const metrics = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    mainLandmarks: document.querySelectorAll('main').length,
  }));
  expect
    .soft(metrics.horizontalOverflow, `${label}: horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect.soft(metrics.mainLandmarks, `${label}: main landmarks`).toBe(1);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  expect
    .soft(
      accessibility.violations.map((violation) => ({
        help: violation.help,
        id: violation.id,
        targets: violation.nodes.map((node) => node.target.join(' ')),
      })),
      `${label}: accessibility violations`,
    )
    .toEqual([]);
  await capture(page, testInfo, label);
}

test('one Memory keeps multiple photos and a sortable local occurrence time', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required pre-push viewport matrix runs once in Chromium.',
  );
  test.setTimeout(180_000);
  const title = `Road-trip memory smoke ${Date.now()}`;
  let monitor: ReturnType<typeof monitorBrowserIssues> | null = null;
  let saved = false;

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto('/dashboard/places');
    await page.getByRole('link', { name: 'New memory' }).first().click();
    await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
      timeout: 20_000,
    });
    const placement = page.getByRole('region', { name: 'Place a memory' });
    await expect(placement).toBeVisible();
    await placement.getByRole('button', { name: 'Use map center' }).click();

    const editor = page.getByRole('dialog', { name: 'Create memory' });
    await expect(editor).toBeVisible({ timeout: 20_000 });
    monitor = monitorBrowserIssues(page);
    await editor.getByRole('textbox', { name: 'Title' }).fill(title);
    await editor.getByLabel('Place').fill('Colorado road trip');
    await editor.getByLabel('Date visited').fill('2026-09-28');
    await editor.getByLabel('Time visited').fill('09:14');
    await editor
      .getByRole('textbox', { name: 'Field note' })
      .fill('Two photographs from one stop, held in the order it happened.');
    await editor.locator('input[type="file"]').setInputFiles(photoFiles);
    await expect(
      editor.getByText(/2 photos were added and saved privately\./i),
    ).toBeVisible({ timeout: 90_000 });
    await expect(editor.locator('figure img')).toHaveCount(2);

    await editor.getByLabel('Time visited').scrollIntoViewIfNeeded();
    await expectEditorFits(page, 'desktop editor');
    await capture(page, testInfo, 'memory-editor-desktop-1440x900', false);

    for (const viewport of [
      { label: 'mobile-portrait-412x915', width: 412, height: 915 },
      { label: 'smallest-portrait-320x568', width: 320, height: 568 },
      { label: 'mobile-landscape-915x412', width: 915, height: 412 },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      // Crossing the mobile breakpoint restarts the drawer entrance animation.
      // Measure and capture only after the responsive state is fully settled.
      await page.waitForTimeout(400);
      await expect(editor).toHaveCSS('opacity', '1');
      await editor.getByLabel('Time visited').scrollIntoViewIfNeeded();
      await expect(editor.getByLabel('Time visited')).toBeVisible();
      await expectEditorFits(page, viewport.label);
      await capture(page, testInfo, `memory-editor-${viewport.label}`, false);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await editor.getByRole('button', { name: 'Keep memory' }).click();
    const savedEditor = page.getByRole('dialog', { name: 'Edit memory' });
    await expect(savedEditor.getByText('Saved to your atlas')).toBeVisible({
      timeout: 30_000,
    });
    saved = true;
    await savedEditor.getByRole('button', { name: 'Close memory' }).click();

    expect(monitor.flush()).toEqual([]);
    monitor.stop();
    monitor = null;

    await page.goto('/dashboard/places');
    const card = page
      .getByRole('region', { name: 'Memories' })
      .getByRole('link', { name: new RegExp(`Open ${title}`) });
    await expect(card).toBeVisible();
    await expect(card.getByText('Sep 28, 2026 · 9:14 AM')).toBeVisible();
    await page.getByRole('link', { name: 'Oldest' }).click();
    await expect(page).toHaveURL(/(?:\?|&)sort=oldest(?:&|$)/);
    await expect(page.getByRole('link', { name: 'Oldest' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    for (const viewport of [
      { label: 'desktop-1440x900', width: 1440, height: 900 },
      { label: 'mobile-portrait-412x915', width: 412, height: 915 },
      { label: 'smallest-portrait-320x568', width: 320, height: 568 },
      { label: 'mobile-landscape-915x412', width: 915, height: 412 },
    ]) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await auditMemoriesList(
        page,
        testInfo,
        `memories-list-${viewport.label}`,
        title,
      );
    }
  } finally {
    monitor?.stop();
    await page.setViewportSize({ width: 1440, height: 900 });
    if (saved) {
      await page.goto('/dashboard');
      await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole('button', { name: 'Open memory list' }).click();
      const tray = page.getByRole('region', { name: 'Your memories' });
      await tray.getByRole('button', { name: new RegExp(title) }).click();
    }
    const editor = page.getByRole('dialog', { name: /(?:Create|Edit) memory/ });
    if (await editor.isVisible().catch(() => false)) {
      const save = editor.getByRole('button', { name: 'Keep memory' });
      if (await save.isVisible().catch(() => false)) {
        await save.click().catch(() => undefined);
        await expect(
          page.getByRole('dialog', { name: 'Edit memory' }),
        ).toBeVisible({ timeout: 30_000 });
      }
      const savedEditor = page.getByRole('dialog', { name: 'Edit memory' });
      await savedEditor
        .getByRole('button', { name: 'Remove', exact: true })
        .click();
      await savedEditor
        .getByRole('button', { name: 'Remove this memory?' })
        .click();
      await expect(savedEditor).toBeHidden({ timeout: 30_000 });
    }
  }
});
