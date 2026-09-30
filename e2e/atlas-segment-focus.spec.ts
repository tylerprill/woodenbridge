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
      latitude: 42.3346,
      longitude: -83.0176,
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

const viewportMatrix = [
  { label: 'desktop-1440x900', width: 1440, height: 900 },
  { label: 'mobile-portrait-412x915', width: 412, height: 915 },
  { label: 'smallest-portrait-320x568', width: 320, height: 568 },
  { label: 'mobile-landscape-915x412', width: 915, height: 412 },
] as const;

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

async function expectJourneyMarkerCoverage(
  page: Page,
  activeStopIndexes: readonly number[] | null,
) {
  const markers = page.locator(
    'button.maplibregl-marker[data-journey-marker="true"]',
  );
  await expect
    .poll(
      () =>
        markers.evaluateAll(
          (markerElements, expectedActiveStopIndexes) => {
            const activeIndexes = expectedActiveStopIndexes
              ? new Set(expectedActiveStopIndexes)
              : null;
            const groups = markerElements.map((marker) => {
              const element = marker as HTMLElement;
              return {
                indexes: (element.dataset.stopIndexes ?? '')
                  .split(',')
                  .filter(Boolean)
                  .map(Number),
                memoryCount: Number(element.dataset.memoryCount ?? 0),
                segment: element.dataset.segment ?? '',
              };
            });

            return {
              coveredStopIndexes: groups
                .flatMap((group) => group.indexes)
                .sort((first, second) => first - second),
              countsMatch: groups.every(
                (group) => group.memoryCount === group.indexes.length,
              ),
              segmentStatesMatch: groups.every((group) => {
                const expectedSegment = activeIndexes
                  ? group.indexes.some((index) => activeIndexes.has(index))
                    ? 'active'
                    : 'inactive'
                  : 'journey';
                return group.segment === expectedSegment;
              }),
            };
          },
          activeStopIndexes ? [...activeStopIndexes] : null,
        ),
      { message: 'Journey markers represent every stop with current state' },
    )
    .toEqual({
      coveredStopIndexes: journey.stops.map((_, index) => index),
      countsMatch: true,
      segmentStatesMatch: true,
    });
}

function journeyMarkerForStopIndexes(page: Page, stopIndexes: string) {
  return page.locator(
    `button.maplibregl-marker[data-journey-marker="true"][data-stop-indexes="${stopIndexes}"]`,
  );
}

function journeyMarkerContainingStop(page: Page, stopIndex: number) {
  const base = 'button.maplibregl-marker[data-journey-marker="true"]';
  return page.locator(
    [
      `${base}[data-stop-indexes="${stopIndex}"]`,
      `${base}[data-stop-indexes^="${stopIndex},"]`,
      `${base}[data-stop-indexes*=",${stopIndex},"]`,
      `${base}[data-stop-indexes$=",${stopIndex}"]`,
    ].join(','),
  );
}

async function expectJourneyMarkersDoNotOverlap(page: Page) {
  const markers = page.locator(
    'button.maplibregl-marker[data-journey-marker="true"]',
  );
  await expect
    .poll(() =>
      markers.evaluateAll((markerElements) => {
        const visible = markerElements.flatMap((marker) => {
          const style = getComputedStyle(marker);
          const bounds = marker.getBoundingClientRect();
          return style.display !== 'none' &&
            style.visibility === 'visible' &&
            Number(style.opacity) > 0 &&
            bounds.width > 0 &&
            bounds.height > 0
            ? [{ bounds, label: marker.getAttribute('aria-label') }]
            : [];
        });
        return visible.flatMap((first, firstIndex) =>
          visible
            .slice(firstIndex + 1)
            .flatMap((second) =>
              first.bounds.left < second.bounds.right &&
              first.bounds.right > second.bounds.left &&
              first.bounds.top < second.bounds.bottom &&
              first.bounds.bottom > second.bounds.top
                ? [`${first.label} overlaps ${second.label}`]
                : [],
            ),
        );
      }),
    )
    .toEqual([]);
}

async function expectActiveSegmentMarkersClear(markers: Locator) {
  await expect
    .poll(() =>
      markers.evaluateAll((activeMarkers) =>
        activeMarkers.reduce(
          (total, marker) =>
            total + Number((marker as HTMLElement).dataset.memoryCount ?? 0),
          0,
        ),
      ),
    )
    .toBe(2);
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
  const activeSegmentMarkers = page.locator(
    'button.maplibregl-marker[data-journey-marker="true"][data-segment="active"]',
  );
  const readJourney = page.getByRole('link', { name: 'Read journey' });
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(readJourney).toHaveAttribute(
    'href',
    `/dashboard/chapters/${journey.id}`,
  );
  await expectJourneyMarkerCoverage(page, null);
  const nearbyDetroitMemories = journeyMarkerContainingStop(page, 0);
  await expect(nearbyDetroitMemories).toHaveCount(1);
  await expect(nearbyDetroitMemories).toHaveAttribute('data-cluster', 'true');
  await expect(nearbyDetroitMemories).toHaveAttribute(
    'data-stop-indexes',
    /^0,1(?:,|$)/,
  );
  await expect(nearbyDetroitMemories).toHaveAttribute(
    'data-memory-count',
    /^(?:[2-9]|[1-9]\d+)$/,
  );
  await expect(nearbyDetroitMemories).toHaveAccessibleName(
    new RegExp(
      `nearby memories, stops 1–\\d+\\. Select to view stop 1, ${journey.stops[0].title}`,
      'i',
    ),
  );
  await expectVisibleJourneyDotsClearOfOverlays(page);
  await expectJourneyMarkersDoNotOverlap(page);

  await nearbyDetroitMemories.click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('stop') === journey.stops[0].entryId,
  );
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
  await expect(readJourney).toHaveAttribute(
    'href',
    `/dashboard/chapters/${journey.id}#journey-segment-${journey.segments[0].id}`,
  );
  await expect(
    page
      .getByRole('list', {
        name: 'Segment 01: Detroit river morning memories',
      })
      .getByRole('button', {
        name: new RegExp(`^1 ${journey.stops[0].title}`, 'i'),
      }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(journeyMarkerContainingStop(page, 0)).toHaveAttribute(
    'aria-current',
    'step',
  );

  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(readJourney).toHaveAttribute(
    'href',
    `/dashboard/chapters/${journey.id}`,
  );
  await expect(page).toHaveURL((url) => !url.searchParams.has('stop'));
  await expectJourneyMarkerCoverage(page, null);
  await audit(page, testInfo, 'journey-overview', monitor);

  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
  await expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(readJourney).toHaveAttribute(
    'href',
    `/dashboard/chapters/${journey.id}#journey-segment-${journey.segments[0].id}`,
  );
  await expectJourneyMarkerCoverage(page, [0, 1]);
  await expect(journeyMarkerForStopIndexes(page, '0')).toHaveCount(1);
  await expect(journeyMarkerForStopIndexes(page, '1')).toHaveCount(1);
  await expectActiveSegmentMarkersClear(activeSegmentMarkers);
  await audit(page, testInfo, 'segment-active', monitor);

  const secondMemory = page.getByRole('button', {
    name: /2 Bikes beneath the Belle Isle trees/i,
  });
  await secondMemory.click();
  await expect(secondMemory).toHaveAttribute('aria-current', 'step');
  await expect(journeyMarkerForStopIndexes(page, '1')).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(journeyMarkerForStopIndexes(page, '1')).toHaveAttribute(
    'data-segment',
    'active',
  );
  await audit(page, testInfo, 'memory-focused', monitor);

  await firstSegment.click();
  await expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
  await expect(readJourney).toHaveAttribute(
    'href',
    `/dashboard/chapters/${journey.id}`,
  );
  await expectJourneyMarkerCoverage(page, null);
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
    await expect(readJourney).toHaveAttribute(
      'href',
      `/dashboard/chapters/${journey.id}#journey-segment-${journey.segments[0].id}`,
    );
    await expectJourneyMarkerCoverage(page, [0, 1]);
    await expectActiveSegmentMarkersClear(activeSegmentMarkers);
    await audit(page, testInfo, 'smallest-portrait-segment', monitor);
  }

  monitor.stop();
});

test('Atlas occupies exactly one viewport at every required breakpoint', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required pre-push viewport matrix runs once in Chromium.',
  );
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const monitor = monitorBrowserIssues(page);

  for (const viewport of viewportMatrix) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await expect(page.locator('[data-map-state="ready"]')).toBeVisible();

      const metrics = await page.evaluate(() => {
        const shellBounds = document
          .querySelector<HTMLElement>('.dashboard-shell')
          ?.getBoundingClientRect();
        const mainBounds = document
          .querySelector<HTMLElement>('.dashboard-main')
          ?.getBoundingClientRect();
        return {
          documentOverflow:
            Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
            ) - window.innerHeight,
          mainBottom: mainBounds?.bottom ?? 0,
          shellBottom: shellBounds?.bottom ?? 0,
          shellTop: shellBounds?.top ?? 0,
          viewportHeight: window.innerHeight,
        };
      });

      expect(metrics.documentOverflow, `${viewport.label}: page height`).toBe(
        0,
      );
      expect(metrics.shellTop, `${viewport.label}: shell top`).toBeCloseTo(
        0,
        1,
      );
      expect(
        metrics.shellBottom,
        `${viewport.label}: shell bottom matches viewport`,
      ).toBeCloseTo(metrics.viewportHeight, 1);
      expect(
        metrics.mainBottom,
        `${viewport.label}: Atlas main bottom matches viewport`,
      ).toBeCloseTo(metrics.viewportHeight, 1);

      await auditCurrentPage(
        page,
        testInfo,
        `atlas-exact-height-${viewport.label}`,
        monitor,
        {
          accessibility: viewport.label === 'desktop-1440x900',
          readySelector: '[data-map-state="ready"]',
        },
      );
    });
  }

  monitor.stop();
});
