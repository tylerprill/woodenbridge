import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import type { AtlasJourneyIndex } from '../app/lib/atlas/journeys/definitions';
import { expectVisibleJourneyDotsClearOfOverlays } from './support/journey-audit';
import { auditCurrentPage, monitorBrowserIssues } from './support/ui-audit';

const journey = {
  id: '4f9ca093-b0d5-456e-9e77-3278c0860931',
  title: 'Segment focus field test',
  version: 1,
  updatedAt: '2026-09-30T12:00:00.000Z',
  startDate: '2026-09-14',
  endDate: '2026-09-20',
  memoryCount: 4,
  drawable: true,
  segments: [
    {
      id: 'aae621dd-a75d-4db4-90ad-c212a5770eb0',
      title: 'Detroit river morning',
      position: 0,
      memoryCount: 2,
      startDate: '2026-09-14',
      endDate: '2026-09-15',
    },
    {
      id: 'dd59b716-f8ee-4ffd-b33a-7914aa9802b8',
      title: 'West to the dunes',
      position: 1,
      memoryCount: 2,
      startDate: '2026-09-17',
      endDate: '2026-09-20',
    },
  ],
  stops: [
    {
      entryId: 'b9188f89-3a93-4cf3-80b0-4f45ca85f649',
      segmentId: 'aae621dd-a75d-4db4-90ad-c212a5770eb0',
      position: 0,
      title: 'Morning along the Detroit RiverWalk',
      placeLabel: 'Detroit RiverWalk, Detroit, Michigan',
      placeName: 'Detroit RiverWalk',
      visitedOn: '2026-09-14',
      latitude: 42.3336,
      longitude: -83.0236,
    },
    {
      entryId: '0320eabe-60b5-4df3-9a41-052246de1a72',
      segmentId: 'aae621dd-a75d-4db4-90ad-c212a5770eb0',
      position: 1,
      title: 'Bikes beneath the Belle Isle trees',
      placeLabel: 'Belle Isle, Detroit, Michigan',
      placeName: 'Belle Isle',
      visitedOn: '2026-09-15',
      latitude: 42.3403,
      longitude: -82.9857,
    },
    {
      entryId: 'ba64601b-3ea7-4050-a727-c3f1163db6e4',
      segmentId: 'dd59b716-f8ee-4ffd-b33a-7914aa9802b8',
      position: 2,
      title: 'Rain settling over Main Street',
      placeLabel: 'Main Street, Ann Arbor, Michigan',
      placeName: 'Main Street',
      visitedOn: '2026-09-17',
      latitude: 42.2796,
      longitude: -83.7487,
    },
    {
      entryId: '7d81ca23-f398-4db1-a352-ebf1e391763d',
      segmentId: 'dd59b716-f8ee-4ffd-b33a-7914aa9802b8',
      position: 3,
      title: 'Dunes above Lake Michigan',
      placeLabel: 'Sleeping Bear Dunes, Michigan',
      placeName: 'Sleeping Bear Dunes',
      visitedOn: '2026-09-20',
      latitude: 44.8826,
      longitude: -86.065,
    },
  ],
} satisfies AtlasJourneyIndex['journeys'][number];

const journeyIndex = {
  journeys: [journey],
  suggestions: [],
} satisfies AtlasJourneyIndex;

function evidenceLabel(testInfo: TestInfo, state: string) {
  return `atlas-segment-focus-${state}-${testInfo.project.name}`;
}

async function signIn(page: Page) {
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Atlas Segment focus coverage requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
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

async function markerDistance(page: Page, first: number, second: number) {
  const markers = page.locator('button.maplibregl-marker[aria-label^="Stop "]');
  const firstBounds = await markers.nth(first).boundingBox();
  const secondBounds = await markers.nth(second).boundingBox();
  if (!firstBounds || !secondBounds) return 0;
  return Math.hypot(
    firstBounds.x +
      firstBounds.width / 2 -
      (secondBounds.x + secondBounds.width / 2),
    firstBounds.y +
      firstBounds.height / 2 -
      (secondBounds.y + secondBounds.height / 2),
  );
}

async function expectActiveSegmentMarkersClear(markers: Locator) {
  await expect(markers).toHaveCount(2);
  await expect
    .poll(
      () =>
        markers.evaluateAll((activeMarkers) =>
          activeMarkers.flatMap((marker) => {
            const bounds = marker.getBoundingClientRect();
            const mapBounds = marker
              .closest('.maplibregl-map')
              ?.getBoundingClientRect();
            if (
              !mapBounds ||
              bounds.left < mapBounds.left ||
              bounds.right > mapBounds.right ||
              bounds.top < mapBounds.top ||
              bounds.bottom > mapBounds.bottom
            ) {
              return [`${marker.getAttribute('aria-label')} is clipped`];
            }
            const topElement = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            return topElement === marker || marker.contains(topElement)
              ? []
              : [`${marker.getAttribute('aria-label')} is obscured`];
          }),
        ),
      { message: 'Active Segment markers stay visible and unobscured' },
    )
    .toEqual([]);
}

async function audit(
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
      accessibility:
        testInfo.project.name === 'chromium' ||
        testInfo.project.name === 'mobile-chromium',
      readySelector: '[data-map-state="ready"]',
    },
  );
}

test('Journey, Segment, and Memory focus form a responsive Atlas hierarchy', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await signIn(page);
  const monitor = monitorBrowserIssues(page);
  await page.route(/\/api\/atlas\/journeys(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(journeyIndex),
    });
  });

  await page
    .getByRole('group', { name: 'Atlas view' })
    .getByRole('button', { name: 'Journeys' })
    .click();
  await page
    .getByRole('button', { name: new RegExp(journey.title, 'i') })
    .click();

  const firstSegment = page.getByRole('button', {
    name: /Segment 01 Detroit river morning/i,
  });
  const secondSegment = page.getByRole('button', {
    name: /Segment 02 West to the dunes/i,
  });
  const markers = page.locator('button.maplibregl-marker[aria-label^="Stop "]');
  const activeSegmentMarkers = page.locator(
    'button.maplibregl-marker[aria-label^="Stop "][data-segment="active"]',
  );
  await expect(markers).toHaveCount(4);
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  for (let index = 0; index < 4; index += 1) {
    await expect(markers.nth(index)).toHaveAttribute('data-segment', 'journey');
  }
  await expectVisibleJourneyDotsClearOfOverlays(page);
  const journeyDistance = await markerDistance(page, 0, 1);
  await audit(page, testInfo, 'journey-overview', monitor);

  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(markers.nth(0)).toHaveAttribute('data-segment', 'active');
  await expect(markers.nth(1)).toHaveAttribute('data-segment', 'active');
  await expect(markers.nth(2)).toHaveAttribute('data-segment', 'inactive');
  await expect
    .poll(() => markerDistance(page, 0, 1), {
      message: 'Opening a Segment fits its memories more tightly',
    })
    .toBeGreaterThan(journeyDistance * 1.2);
  await expectActiveSegmentMarkersClear(activeSegmentMarkers);
  await audit(page, testInfo, 'segment-active', monitor);

  const secondMemory = page.getByRole('button', {
    name: /2 Bikes beneath the Belle Isle trees/i,
  });
  await secondMemory.click();
  await expect(secondMemory).toHaveAttribute('aria-current', 'step');
  await expect(markers.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(markers.nth(1)).toHaveAttribute('data-segment', 'active');
  await audit(page, testInfo, 'memory-focused', monitor);

  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  for (let index = 0; index < 4; index += 1) {
    await expect(markers.nth(index)).toHaveAttribute('data-segment', 'journey');
  }
  await expectVisibleJourneyDotsClearOfOverlays(page);

  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(
      `/dashboard?view=journeys&journey=${encodeURIComponent(journey.id)}`,
      { waitUntil: 'domcontentloaded' },
    );
    await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
    await firstSegment.click();
    await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
    await expectActiveSegmentMarkersClear(activeSegmentMarkers);
    await audit(page, testInfo, 'smallest-portrait-segment', monitor);
  }

  monitor.stop();
});
