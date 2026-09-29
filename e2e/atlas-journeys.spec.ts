import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { E2E_FIXTURE } from '../scripts/seed-e2e.js';
import {
  expectActiveJourneyDotClearOfOverlays,
  expectJourneyPlaybackPreviewHasRoom,
  expectVisibleJourneyDotsClearOfOverlays,
} from './support/journey-audit';
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
const journeySegments = [
  {
    title: 'Detroit river morning',
    memories: memories.slice(0, 2),
  },
  {
    title: 'West to the dunes',
    memories: memories.slice(2),
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
      expectedMapTeardown: page.url().includes('/dashboard/chapters/new'),
      readySelector: page.url().includes('/dashboard/chapters/new')
        ? undefined
        : '[data-map-state="ready"]',
    },
  );
}

async function expectJourneyDotContentCenteredInMarkers(page: Page) {
  const centerErrors = await page
    .locator('button.maplibregl-marker[aria-label^="Stop "]')
    .evaluateAll((markers) =>
      markers.map((marker) => {
        const dot = marker.querySelector('span');
        if (!dot)
          return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
        const markerBounds = marker.getBoundingClientRect();
        const dotBounds = dot.getBoundingClientRect();
        return {
          x: Math.abs(
            markerBounds.left +
              markerBounds.width / 2 -
              (dotBounds.left + dotBounds.width / 2),
          ),
          y: Math.abs(
            markerBounds.top +
              markerBounds.height / 2 -
              (dotBounds.top + dotBounds.height / 2),
          ),
        };
      }),
    );

  expect(centerErrors.length).toBeGreaterThan(1);
  for (const error of centerErrors) {
    expect
      .soft(error.x, 'Journey dot horizontal content drift')
      .toBeLessThan(0.6);
    expect
      .soft(error.y, 'Journey dot vertical content drift')
      .toBeLessThan(0.6);
  }
}

test('Journey Lens connects the Atlas, playback, and Journey workshop', async ({
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
    atlasView.getByRole('button', { name: 'Memories' }),
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
    page.getByRole('button', { name: new RegExp(primaryJourney.title, 'i') }),
  ).toContainText('2 segments · 4 memories');
  await expect(
    page.getByRole('button', {
      name: new RegExp(overlappingJourney.title, 'i'),
    }),
  ).toBeVisible();
  await auditJourneyState(page, testInfo, 'overview', monitor);

  await page
    .getByRole('button', { name: new RegExp(primaryJourney.title, 'i') })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await expectVisibleJourneyDotsClearOfOverlays(page);
  await expect(page.getByRole('button', { name: 'Relive' })).toBeInViewport({
    ratio: 1,
  });
  const firstSegment = page.getByRole('button', {
    name: new RegExp(`Segment 01 ${journeySegments[0].title}`, 'i'),
  });
  const secondSegment = page.getByRole('button', {
    name: new RegExp(`Segment 02 ${journeySegments[1].title}`, 'i'),
  });
  await expect(firstSegment).toHaveAttribute(
    'aria-controls',
    /^journey-segment-/,
  );
  await expect(secondSegment).toHaveAttribute(
    'aria-controls',
    /^journey-segment-/,
  );
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  const firstSegmentMemories = page.getByRole('list', {
    name: `Segment 01: ${journeySegments[0].title} memories`,
  });
  await expect(firstSegmentMemories.getByRole('listitem')).toHaveCount(2);
  await expect(
    firstSegmentMemories.getByRole('button', {
      name: new RegExp(`^1 ${memories[0].title}`, 'i'),
    }),
  ).toBeVisible();
  await expect(
    firstSegmentMemories.getByRole('button', {
      name: new RegExp(`^2 ${memories[1].title}`, 'i'),
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', {
      name: `Segment 02: ${journeySegments[1].title} memories`,
    }),
  ).toHaveCount(0);

  await secondSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'true');
  const secondSegmentPanelId =
    await secondSegment.getAttribute('aria-controls');
  expect(secondSegmentPanelId).toBeTruthy();
  await expect(page.locator(`#${secondSegmentPanelId}`)).toBeVisible();
  const manuallyOpenedSecondSegment = page.getByRole('list', {
    name: `Segment 02: ${journeySegments[1].title} memories`,
  });
  await expect(
    manuallyOpenedSecondSegment.getByRole('button', {
      name: new RegExp(`^3 ${memories[2].title}`, 'i'),
    }),
  ).toBeVisible();
  await secondSegment.click();
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
  await auditJourneyState(page, testInfo, 'fitted-detail', monitor);

  const detailUrl = new URL('/dashboard', 'http://field-atlas.test');
  detailUrl.searchParams.set('view', 'journeys');
  detailUrl.searchParams.set('journey', primaryJourney.id);
  detailUrl.searchParams.set('stop', memories[2].id);
  await page.goto(`${detailUrl.pathname}${detailUrl.search}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });

  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'true');
  const secondSegmentMemories = page.getByRole('list', {
    name: `Segment 02: ${journeySegments[1].title} memories`,
  });
  await expect(secondSegmentMemories.getByRole('listitem')).toHaveCount(2);
  await expect(
    secondSegmentMemories.getByRole('button', {
      name: new RegExp(`^3 ${memories[2].title}`, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(
    secondSegmentMemories.getByRole('button', {
      name: new RegExp(`^3 ${memories[2].title}`, 'i'),
    }),
  ).toBeInViewport({ ratio: 0.95 });

  const mapStops = page.locator(
    'button.maplibregl-marker[aria-label^="Stop "]',
  );
  await expect(mapStops).toHaveCount(memories.length);
  for (let index = 0; index < memories.length; index += 1) {
    const memory = memories[index];
    await expect(mapStops.nth(index)).toHaveAttribute(
      'aria-label',
      new RegExp(
        `^Stop ${index + 1} of ${memories.length}: ${memory.title}`,
        'i',
      ),
    );
  }
  await expectJourneyDotContentCenteredInMarkers(page);
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Stop 3 of 4: ${memories[2].title}`, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');
  await expectActiveJourneyDotClearOfOverlays(page);
  await expect(page.getByRole('button', { name: 'Relive' })).toBeInViewport();
  await auditJourneyState(page, testInfo, 'detail', monitor);

  await page.getByRole('button', { name: 'Relive' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await expect(page.getByText('Stop 3 of 4', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: memories[2].title }),
  ).toBeVisible();
  await expectActiveJourneyDotClearOfOverlays(page);
  await expectJourneyPlaybackPreviewHasRoom(page);

  await page.getByRole('button', { name: 'Next stop' }).click();
  await expect(page.getByText('Stop 4 of 4', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 3, name: memories[3].title }),
  ).toBeVisible();
  await expect(page).toHaveURL((url) => {
    return (
      url.searchParams.get('journey') === primaryJourney.id &&
      url.searchParams.get('stop') === memories[3].id
    );
  });
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Stop 4 of 4: ${memories[3].title}`, 'i'),
    }),
  ).toHaveAttribute('aria-current', 'step');
  await expectActiveJourneyDotClearOfOverlays(page);
  await expectJourneyPlaybackPreviewHasRoom(page);

  await page.getByRole('button', { name: 'Play journey' }).click();
  await expect(
    page.getByRole('button', { name: 'Pause journey' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pause journey' }).click();
  await expectActiveJourneyDotClearOfOverlays(page);
  await expectJourneyPlaybackPreviewHasRoom(page);
  await auditJourneyState(page, testInfo, 'playback', monitor);

  await page.getByRole('button', { name: 'Exit playback' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: primaryJourney.title }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to journeys' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Your journeys' }),
  ).toBeVisible();
  await auditJourneyState(page, testInfo, 'overview-return', monitor);

  await page
    .getByRole('button', { name: new RegExp(overlappingJourney.title, 'i') })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: overlappingJourney.title }),
  ).toBeVisible();
  const legacyJourneyStops = page.getByRole('list', {
    name: `${overlappingJourney.title} stops`,
  });
  await expect(legacyJourneyStops.getByRole('listitem')).toHaveCount(3);
  await expect(
    page.getByLabel(`${overlappingJourney.title} segments`),
  ).toHaveCount(0);
  await auditJourneyState(page, testInfo, 'legacy-flat-detail', monitor);
  await page.getByRole('button', { name: 'Back to journeys' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Your journeys' }),
  ).toBeVisible();

  const journeyTray = page.locator(
    'section[aria-labelledby="journey-tray-title"]',
  );
  await expect(
    journeyTray.getByRole('button', { name: /Create journey/i }),
  ).toHaveCount(0);
  await expect(journeyTray.getByRole('button', { name: 'Review' })).toHaveCount(
    0,
  );
  const allJourneys = journeyTray.getByRole('link', { name: 'All journeys' });
  await expect(allJourneys).toHaveAttribute('href', '/dashboard/chapters');
  await auditJourneyState(page, testInfo, 'creation-removed', monitor);

  await allJourneys.click();
  await expect(page).toHaveURL('/dashboard/chapters');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Journeys.' }),
  ).toBeVisible();
  const newJourney = page.getByRole('link', { name: 'New journey' });
  await expect(newJourney).toHaveAttribute('href', '/dashboard/chapters/new');
  await auditCurrentPage(
    page,
    testInfo,
    evidenceLabel(testInfo, 'journey-list-creation'),
    monitor,
    {
      accessibility: shouldAuditAccessibility(testInfo),
      expectedHeading: 'Journeys.',
      expectedPath: '/dashboard/chapters',
    },
  );

  await newJourney.click();
  await expect(page).toHaveURL('/dashboard/chapters/new');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Begin a new journey.' }),
  ).toBeVisible();
  await expect(
    page
      .locator('.dashboard-nav-links')
      .getByRole('link', { name: 'Journeys' }),
  ).toHaveAttribute('href', '/dashboard/chapters');
  await auditJourneyState(page, testInfo, 'journey-workshop', monitor);

  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${detailUrl.pathname}${detailUrl.search}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByRole('heading', { level: 2, name: primaryJourney.title }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('list', {
          name: `Segment 02: ${journeySegments[1].title} memories`,
        })
        .getByRole('button', {
          name: new RegExp(`^3 ${memories[2].title}`, 'i'),
        }),
    ).toBeInViewport({ ratio: 0.95 });
    await auditJourneyState(page, testInfo, 'detail-smallest-phone', monitor);
  }

  monitor.stop();
});
