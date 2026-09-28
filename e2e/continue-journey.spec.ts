import path from 'node:path';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { monitorBrowserIssues } from './support/ui-audit';

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
      'Continue Journey smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
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
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(label, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

async function expectViewportFits(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    horizontalOverflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect
    .soft(metrics.horizontalOverflow, `${label}: horizontal overflow`)
    .toBeLessThanOrEqual(1);

  const dialog = page.getByRole('dialog', { name: /(?:Create|Edit) memory/ });
  if (await dialog.isVisible().catch(() => false)) {
    const bounds = await dialog.boundingBox();
    expect.soft(bounds, `${label}: editor bounds`).not.toBeNull();
    if (bounds) {
      expect.soft(bounds.x, `${label}: editor left`).toBeGreaterThanOrEqual(0);
      expect.soft(bounds.y, `${label}: editor top`).toBeGreaterThanOrEqual(0);
      expect
        .soft(bounds.x + bounds.width, `${label}: editor right`)
        .toBeLessThanOrEqual(metrics.viewportWidth);
      expect
        .soft(bounds.y + bounds.height, `${label}: editor bottom`)
        .toBeLessThanOrEqual(metrics.viewportHeight);
    }
  }
}

async function openContinuation(page: Page, testInfo?: TestInfo) {
  await page.getByRole('link', { name: 'Continue journey' }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/chapters\/[0-9a-f-]+\/edit\?step=continue(?:&|$)/i,
  );
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
  const placement = page.getByRole('region', { name: 'Place a memory' });
  await expect(placement).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Place the next memory.' }),
  ).toBeVisible();
  if (testInfo) {
    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await placement.scrollIntoViewIfNeeded();
      await expect(placement).toBeVisible();
      await expectViewportFits(page, `Journey workshop ${viewport.label}`);
      await capture(
        page,
        testInfo,
        `continue-journey-workshop-${viewport.label}`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await placement.getByRole('button', { name: 'Use map center' }).click();
  const editor = page.getByRole('dialog', { name: 'Create memory' });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  return editor;
}

async function removeTestMemory(page: Page, journeyId: string, title: string) {
  await page.goto(`/dashboard/chapters/${journeyId}/edit`);
  const arrange = page.getByRole('button', { name: /Arrange & share/i });
  await expect(async () => {
    await arrange.click();
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/chapters/${journeyId}/edit\\?step=arrange$`),
    );
  }).toPass({ timeout: 20_000 });
  const route = page.locator('aside').filter({ hasText: 'The route.' });
  const remove = route.getByRole('button', { name: `Remove ${title}` });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toBeHidden();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/dashboard/chapters/${journeyId}\\?saved=updated$`),
    { timeout: 30_000 },
  );

  await page.goto('/dashboard');
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Open memory list' }).click();
  const tray = page.getByRole('region', { name: 'Your memories' });
  await tray.getByRole('button', { name: new RegExp(title) }).click();
  const savedEditor = page.getByRole('dialog', { name: 'Edit memory' });
  await savedEditor.getByRole('button', { name: 'Remove' }).click();
  await savedEditor
    .getByRole('button', { name: 'Remove this memory?' })
    .click();
  await expect(savedEditor).toBeHidden({ timeout: 30_000 });
}

test('a Journey can be continued with a new Memory', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required pre-push viewport matrix runs once in Chromium.',
  );
  test.setTimeout(240_000);
  const title = `Continued road-trip memory ${Date.now()}`;
  const segmentTitle = `Road-trip day ${Date.now()}`;
  let journeyId = '';
  let saved = false;
  let draftOpen = false;
  let monitor: ReturnType<typeof monitorBrowserIssues> | null = null;

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto('/dashboard/chapters');
    const journeyList = page.getByRole('region', { name: 'Your journeys' });
    await expect(journeyList).toBeVisible();
    const firstJourney = journeyList.getByRole('link').first();
    await expect(firstJourney).toBeVisible();
    await firstJourney.click();
    await expect(
      page.getByRole('link', { name: 'Continue journey' }),
    ).toBeVisible();
    journeyId = new URL(page.url()).pathname.split('/').at(-1) ?? '';
    expect(journeyId).toMatch(/^[0-9a-f-]{36}$/i);
    const journeyTitle = await page
      .getByRole('heading', { level: 1 })
      .textContent();
    expect(journeyTitle).toBeTruthy();
    const staleTitles = (
      await page
        .getByRole('list', { name: 'Journey memories in route order' })
        .locator('h3')
        .allTextContents()
    ).filter((candidate) =>
      candidate.startsWith('Continued road-trip memory '),
    );
    for (const staleTitle of staleTitles) {
      await removeTestMemory(page, journeyId, staleTitle);
      await page.goto(`/dashboard/chapters/${journeyId}`);
    }

    const cancelledEditor = await openContinuation(page);
    draftOpen = true;
    await expect(cancelledEditor.getByText('Continuing journey')).toBeVisible();
    await expect(cancelledEditor.getByText(journeyTitle!)).toBeVisible();
    await cancelledEditor
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await cancelledEditor
      .getByRole('button', { name: 'Discard memory?' })
      .click();
    draftOpen = false;
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/chapters/${journeyId}$`),
      { timeout: 30_000 },
    );

    const editor = await openContinuation(page, testInfo);
    draftOpen = true;
    monitor = monitorBrowserIssues(page);
    await editor.getByLabel('Journey segment').selectOption('new');
    await editor.getByLabel('New segment name').fill(segmentTitle);
    await editor.getByRole('textbox', { name: 'Title' }).fill(title);
    await editor.getByLabel('Place').fill('Road-trip lunch stop');
    await editor.getByLabel('Date visited').fill('2026-09-28');
    await editor.getByLabel('Time visited').fill('13:24');
    await editor
      .getByRole('textbox', { name: 'Field note' })
      .fill('A second stop added directly from the Journey reader.');
    await editor.locator('input[type="file"]').setInputFiles(photo);
    await expect(
      editor.getByText(/1 photo was added and saved privately\./i),
    ).toBeVisible({ timeout: 90_000 });

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await editor.getByText('Continuing journey').scrollIntoViewIfNeeded();
      await expect(editor.getByText('Continuing journey')).toBeVisible();
      await expectViewportFits(page, `continuation editor ${viewport.label}`);
      await capture(
        page,
        testInfo,
        `continue-journey-editor-${viewport.label}`,
      );
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await editor.getByRole('button', { name: 'Add to journey' }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/dashboard/chapters/${journeyId}\\?saved=continued#chapter-memories$`,
      ),
      { timeout: 30_000 },
    );
    saved = true;
    draftOpen = false;
    await expect(page.getByText('Memory added.')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: segmentTitle }),
    ).toBeVisible();
    const timeline = page.getByRole('list', {
      name: 'Journey memories in route order',
    });
    await expect(timeline.locator('h3').last()).toHaveText(title);
    const newMemoryPhoto = timeline.getByRole('listitem').last().locator('img');
    await expect(newMemoryPhoto).toHaveCount(1);
    await expect
      .poll(async () =>
        newMemoryPhoto.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const newMemoryPhotoSource = await newMemoryPhoto.getAttribute('src');
    expect(newMemoryPhotoSource).toBeTruthy();
    expect(
      (
        await page
          .context()
          .request.get(new URL(newMemoryPhotoSource!, page.url()).href)
      ).status(),
    ).toBe(200);

    for (const viewport of viewports) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await page
        .getByRole('heading', { name: segmentTitle })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByRole('heading', { name: segmentTitle }),
      ).toBeVisible();
      await timeline.locator('h3').last().scrollIntoViewIfNeeded();
      await expect(timeline.locator('h3').last()).toBeVisible();
      await expectViewportFits(page, `continued Journey ${viewport.label}`);
      await capture(
        page,
        testInfo,
        `continue-journey-reader-${viewport.label}`,
      );
    }

    const unexpectedBrowserIssues = monitor.flush().filter((issue) => {
      const isMissingLegacyFixtureImage =
        issue.kind === 'http-response'
          ? issue.status === 404 &&
            issue.resourceType === 'image' &&
            new URL(issue.url).pathname.startsWith('/api/atlas/media/')
          : issue.kind === 'console' &&
            issue.level === 'error' &&
            issue.message.includes('404') &&
            Boolean(
              issue.url &&
              new URL(issue.url).pathname.startsWith('/api/atlas/media/'),
            );
      return !isMissingLegacyFixtureImage;
    });
    expect(unexpectedBrowserIssues).toEqual([]);
    monitor.stop();
    monitor = null;
  } finally {
    monitor?.stop();
    await page.setViewportSize({ width: 1440, height: 900 });
    if (draftOpen) {
      const draftEditor = page.getByRole('dialog', { name: 'Create memory' });
      if (await draftEditor.isVisible().catch(() => false)) {
        const cancel = draftEditor.getByRole('button', {
          name: 'Cancel',
          exact: true,
        });
        await cancel.click().catch(() => undefined);
        await draftEditor
          .getByRole('button', { name: 'Discard memory?' })
          .click()
          .catch(() => undefined);
      }
    }
    if (saved && journeyId) {
      await removeTestMemory(page, journeyId, title);
    }
  }
});
