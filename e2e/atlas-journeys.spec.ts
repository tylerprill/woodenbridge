import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { E2E_FIXTURE } from '../scripts/seed-e2e.js';
import { auditCurrentPage, monitorBrowserIssues } from './support/ui-audit';

const primaryJourney = {
  id: E2E_FIXTURE.chapterId,
  title: 'Michigan, mile by mile',
};
const overlappingJourney = {
  id: E2E_FIXTURE.overlapChapterId,
  title: 'City streets and river light',
};
const memories = [
  {
    id: E2E_FIXTURE.entryIds[0],
    title: 'Morning along the Detroit RiverWalk',
  },
  {
    id: E2E_FIXTURE.entryIds[1],
    title: 'Bikes beneath the Belle Isle trees',
  },
  {
    id: E2E_FIXTURE.entryIds[2],
    title: 'Rain settling over Main Street',
  },
  {
    id: E2E_FIXTURE.entryIds[3],
    title: 'Dunes above Lake Michigan',
  },
] as const;

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('mobile-');
}

function evidenceLabel(testInfo: TestInfo, state: string) {
  return `atlas-journeys-${state}-${testInfo.project.name}`;
}

function shouldAuditAccessibility(testInfo: TestInfo) {
  return (
    testInfo.project.name === 'chromium' ||
    testInfo.project.name === 'mobile-chromium'
  );
}

async function signIn(page: Page) {
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    const missingCredentials = [
      !email ? 'E2E_TEST_EMAIL' : null,
      !password ? 'E2E_TEST_PASSWORD' : null,
    ].filter((name): name is string => Boolean(name));
    throw new Error(
      `Atlas Journey Lens coverage requires ${missingCredentials.join(' and ')}.`,
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, { timeout: 20_000 });
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
}

async function auditJourneyState(
  page: Page,
  testInfo: TestInfo,
  state: string,
  monitor: ReturnType<typeof monitorBrowserIssues>,
) {
  await auditCurrentPage(
    page,
    testInfo,
    evidenceLabel(testInfo, state),
    monitor,
    {
      accessibility: shouldAuditAccessibility(testInfo),
      readySelector: page.url().includes('/dashboard/chapters/new')
        ? undefined
        : '[data-map-state="ready"]',
    },
  );
}

test('Journey Lens connects the Atlas, playback, and Chapter workshop', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  if (!isMobileProject(testInfo)) {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await signIn(page);
  const monitor = monitorBrowserIssues(page);

  const atlasView = page.getByRole('group', { name: 'Atlas view' });
  await expect(
    atlasView.getByRole('button', { name: 'Places' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await atlasView.getByRole('button', { name: 'Journeys' }).click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard' &&
      url.searchParams.get('view') === 'journeys'
    );
  });
  await expect(
    page.getByRole('heading', { level: 2, name: 'Your journeys' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: new RegExp(primaryJourney.title, 'i') }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: new RegExp(overlappingJourney.title, 'i'),
    }),
  ).toBeVisible();
  await auditJourneyState(page, testInfo, 'overview', monitor);

  const detailUrl = new URL('/dashboard', 'http://field-atlas.test');
  detailUrl.searchParams.set('view', 'journeys');
  detailUrl.searchParams.set('journey', primaryJourney.id);
  detailUrl.searchParams.set('stop', memories[1].id);
  await page.goto(`${detailUrl.pathname}${detailUrl.search}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });

  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  const journeyStops = page.getByRole('list', {
    name: `${primaryJourney.title} stops`,
  });
  await expect(journeyStops.getByRole('listitem')).toHaveCount(memories.length);
  await expect(
    journeyStops.getByRole('button', {
      name: new RegExp(memories[1].title, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');

  const mapStops = page.locator(
    'button.maplibregl-marker[aria-label^="Stop "]',
  );
  await expect(mapStops).toHaveCount(memories.length);
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Stop 2 of 4: ${memories[1].title}`, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');
  await auditJourneyState(page, testInfo, 'detail', monitor);

  await page.getByRole('button', { name: 'Relive' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await expect(page.getByText('Stop 2 of 4', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: memories[1].title }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Next stop' }).click();
  await expect(page.getByText('Stop 3 of 4', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: memories[2].title }),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => {
    return (
      url.searchParams.get('journey') === primaryJourney.id &&
      url.searchParams.get('stop') === memories[2].id
    );
  });
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Stop 3 of 4: ${memories[2].title}`, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');

  await page.getByRole('button', { name: 'Play journey' }).click();
  await expect(
    page.getByRole('button', { name: 'Pause journey' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause journey' }).click();
  await auditJourneyState(page, testInfo, 'playback', monitor);

  await page.getByRole('button', { name: 'Exit playback' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to journeys' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Your journeys' }),
  ).toBeVisible();

  const journeyTools = page.getByRole('toolbar', { name: 'Journey tools' });
  await journeyTools.getByRole('button', { name: 'Create journey' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Choose the memories' }),
  ).toBeVisible();

  const availableMemories = page.locator('button[data-selected]');
  await availableMemories.filter({ hasText: memories[0].title }).click();
  await availableMemories.filter({ hasText: memories[1].title }).click();
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

  const shapeChapter = page.getByRole('link', { name: 'Shape chapter' });
  const shapeChapterHref = await shapeChapter.getAttribute('href');
  expect(shapeChapterHref).not.toBeNull();
  const shapeChapterUrl = new URL(
    shapeChapterHref ?? '',
    'http://field-atlas.test',
  );
  expect(shapeChapterUrl.pathname).toBe('/dashboard/chapters/new');
  expect(shapeChapterUrl.searchParams.get('source')).toBe('atlas');
  expect(shapeChapterUrl.searchParams.getAll('memory')).toEqual([
    memories[0].id,
    memories[1].id,
  ]);
  await auditJourneyState(page, testInfo, 'builder', monitor);

  await shapeChapter.click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/chapters/new' &&
      url.searchParams.get('source') === 'atlas'
    );
  });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Begin a new chapter.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: `Remove ${memories[0].title}`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: `Remove ${memories[1].title}`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Back to Atlas' }),
  ).toHaveAttribute('href', '/dashboard?view=journeys');
  await auditJourneyState(page, testInfo, 'prefilled-chapter', monitor);

  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${detailUrl.pathname}${detailUrl.search}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { level: 2, name: primaryJourney.title }),
    ).toBeVisible();
    await auditJourneyState(page, testInfo, 'detail-smallest-phone', monitor);
  }

  monitor.stop();
});
