import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { auditCurrentPage, monitorBrowserIssues } from './support/ui-audit';

const photo = path.join(
  process.cwd(),
  'output/uiux-image-upload/test-images/riverwalk-test.png',
);

const viewports = [
  { label: 'desktop-1440x900', width: 1440, height: 900 },
  { label: 'mobile-portrait-412x915', width: 412, height: 915 },
  { label: 'smallest-portrait-320x568', width: 320, height: 568 },
  { label: 'mobile-landscape-915x412', width: 915, height: 412 },
] as const;

async function signIn(page: Page) {
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Place-only title smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, {
    timeout: 20_000,
  });
}

test('photo import suggests the place without putting the date in the title', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required pre-push viewport matrix runs once in Chromium.',
  );
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto('/dashboard/import', { waitUntil: 'networkidle' });
  const monitor = monitorBrowserIssues(page);

  try {
    await page
      .getByLabel('Choose photos', { exact: true })
      .setInputFiles(photo);
    await expect(
      page.getByText('1 photo is ready to review.', { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Review 1 photo' }).click();

    const confirmDate = page.getByRole('button', {
      name: 'Confirm 1 file date',
    });
    if (await confirmDate.isVisible().catch(() => false)) {
      await confirmDate.click();
    }

    await page.getByRole('button', { name: 'Choose place' }).click();
    const locationDialog = page.getByRole('dialog', {
      name: 'Choose where this belongs.',
    });
    await expect(
      locationDialog.locator('[data-map-state="ready"]'),
    ).toBeVisible({
      timeout: 20_000,
    });
    await locationDialog
      .getByRole('button', { name: 'Use map center' })
      .click();
    await expect(locationDialog).toBeHidden({ timeout: 45_000 });

    await page.getByRole('button', { name: 'Add optional details' }).click();
    const title = page.getByRole('textbox', { name: /^Title/ });
    const place = page.getByRole('textbox', { name: 'Place' });
    const visitedOn = page.getByLabel('Date visited');
    const placeValue = await place.inputValue();
    const dateValue = await visitedOn.inputValue();

    expect(placeValue).toBe('Detroit, Michigan');
    await expect(title).toHaveValue(placeValue);
    expect(await title.inputValue()).not.toContain(dateValue);
    expect(await title.inputValue()).not.toMatch(/\b(?:19|20)\d{2}\b/);

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await title.scrollIntoViewIfNeeded();
      await expect(title).toBeVisible();
      await expect(title).toHaveValue(placeValue);
      await auditCurrentPage(
        page,
        testInfo,
        `place-only-memory-title-${viewport.label}`,
        monitor,
        { accessibility: true },
      );
    }

    await title.fill('A title I chose');
    await visitedOn.fill('2026-09-27');
    await expect(title).toHaveValue('A title I chose');
  } finally {
    monitor.stop();
  }
});
