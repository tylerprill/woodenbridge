import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { monitorBrowserIssues } from './support/ui-audit';

const journeyId =
  process.env.E2E_CHAPTER_ID?.trim() || '6a67afcf-768f-4fe4-8c62-41b58a19840d';

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
      'Journey Segment smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
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

async function capture(page: Page, testInfo: TestInfo, label: string) {
  const screenshotPath = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach(label, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

async function expectSegmentEditorFits(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[aria-label^="Name for segment "], [aria-label^="Segment for "], [aria-label^="Start a segment here before "]',
      ),
    ).filter((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    });
    return {
      clipped: controls
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > window.innerWidth + 1;
        })
        .map((element) => element.getAttribute('aria-label')),
      horizontalOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

  expect
    .soft(metrics.horizontalOverflow, `${label}: horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(metrics.clipped, `${label}: clipped Segment controls`)
    .toEqual([]);
}

test('an existing Journey can be divided into editable Segments', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required pre-push viewport matrix runs once in Chromium.',
  );
  test.setTimeout(120_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto(`/dashboard/chapters/${journeyId}/edit?step=arrange`);
  await expect(page.getByRole('heading', { name: 'The route.' })).toBeVisible();
  const monitor = monitorBrowserIssues(page);

  try {
    const divideButton = page.getByRole('button', {
      name: 'Divide into segments',
    });
    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await divideButton.scrollIntoViewIfNeeded();
      await expect(divideButton).toBeVisible();
      const divideButtonBounds = await divideButton.boundingBox();
      expect(
        divideButtonBounds,
        `${viewport.label}: divide button bounds`,
      ).not.toBeNull();
      expect(
        divideButtonBounds?.height,
        `${viewport.label}: divide button height`,
      ).toBeGreaterThanOrEqual(40);
      await capture(page, testInfo, `journey-segment-guide-${viewport.label}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await divideButton.click();
    await expect(page.getByLabel('Name for segment 1')).toHaveValue(
      'Segment 1',
    );
    await page.getByLabel('Name for segment 1').fill('Day 1 · Mountains');

    const startButtons = page.getByRole('button', {
      name: /^Start a segment here before /,
    });
    await expect(startButtons.first()).toBeVisible();
    await startButtons.first().click();
    await expect(page.getByLabel('Name for segment 2')).toHaveValue(
      'Segment 2',
    );
    await page.getByLabel('Name for segment 2').fill('Day 2 · Coast');

    const segmentPickers = page.locator('select[aria-label^="Segment for "]');
    expect(await segmentPickers.count()).toBeGreaterThanOrEqual(3);
    const firstSegmentId = await segmentPickers.nth(0).inputValue();
    const secondSegmentId = await segmentPickers.nth(1).inputValue();
    expect(firstSegmentId).not.toBe(secondSegmentId);
    await segmentPickers.nth(1).selectOption(firstSegmentId);
    await expect(segmentPickers.nth(1)).toHaveValue(firstSegmentId);
    await expect(segmentPickers.nth(2)).toHaveValue(secondSegmentId);

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page.getByLabel('Name for segment 2').scrollIntoViewIfNeeded();
      await expect(page.getByLabel('Name for segment 2')).toBeVisible();
      await expectSegmentEditorFits(page, viewport.label);
      await capture(page, testInfo, `journey-segments-${viewport.label}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole('button', { name: 'Remove Day 2 · Coast segment' })
      .click();
    await expect(
      page.locator('input[aria-label^="Name for segment "]'),
    ).toHaveCount(1);
    await expect(segmentPickers).toHaveCount(10);
    await page
      .getByRole('button', { name: 'Remove Day 1 · Mountains segment' })
      .click();
    await expect(
      page.getByRole('button', { name: 'Divide into segments' }),
    ).toBeVisible();
    await expect(page.getByText(/memories selected/)).toHaveText(
      /10\s*memories selected/,
    );

    expect(monitor.flush()).toEqual([]);
  } finally {
    monitor.stop();
  }
});
