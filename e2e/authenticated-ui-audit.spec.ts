import path from 'node:path';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  auditCurrentPage,
  monitorBrowserIssues,
  openAndAudit,
} from './support/ui-audit';

const fixtureRoot = path.join(
  process.cwd(),
  'output/uiux-image-upload/test-images',
);
const e2eChapterId =
  process.env.E2E_CHAPTER_ID?.trim() || '6a67afcf-768f-4fe4-8c62-41b58a19840d';
const e2eEntryId =
  process.env.E2E_ENTRY_ID?.trim() || '0a934c64-997f-43c2-88a3-8b102d517781';

type AuditViewport = {
  name: string;
  width?: number;
  height?: number;
};

type AuthenticatedRoute = {
  expectedHeading?: string | RegExp;
  expectedPath?: string | RegExp;
  expectedSelector?: string;
  name: string;
  path: string;
  readyButton?: string | RegExp;
  readySelector?: string;
};

const nativeMobileViewport: AuditViewport[] = [{ name: 'native' }];

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('mobile-');
}

function auditedViewports(testInfo: TestInfo): AuditViewport[] {
  if (isMobileProject(testInfo)) return nativeMobileViewport;
  if (testInfo.project.name === 'chromium') {
    return [
      { name: 'small-phone', width: 320, height: 568 },
      { name: 'mobile-landscape', width: 568, height: 320 },
      { name: 'tablet', width: 901, height: 900 },
      { name: 'short-desktop', width: 1280, height: 600 },
      { name: 'desktop', width: 1440, height: 900 },
    ];
  }
  return [{ name: 'desktop', width: 1440, height: 900 }];
}

async function applyViewport(page: Page, viewport: AuditViewport) {
  if (viewport.width && viewport.height) {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });
  }
}

function shouldRunAccessibilityAudit(
  testInfo: TestInfo,
  viewport: AuditViewport,
) {
  return (
    (testInfo.project.name === 'chromium' &&
      (viewport.name === 'small-phone' || viewport.name === 'desktop')) ||
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
      `Authenticated UI audit requires ${missingCredentials.join(' and ')}.`,
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, { timeout: 20_000 });
  await page.waitForLoadState('load');
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
}

test('authenticated routes and primary interactions pass the UI audit', async ({
  page,
}, testInfo) => {
  test.setTimeout(480_000);
  await signIn(page);
  // This suite consumes login as test setup; the public UI audit owns the
  // login page itself. Start route diagnostics at the authenticated boundary
  // so the intentional server-action navigation cannot leak into page checks.
  const monitor = monitorBrowserIssues(page);

  const routes: AuthenticatedRoute[] = [
    {
      name: 'atlas',
      path: '/dashboard',
      expectedHeading: /world$/,
      readySelector: '[data-map-state="ready"]',
    },
    {
      name: 'upload',
      path: '/dashboard/import',
      expectedHeading: 'Turn your camera roll into an atlas.',
    },
    {
      name: 'places',
      path: '/dashboard/places',
      expectedHeading: 'Your collection.',
    },
    {
      name: 'on-this-day',
      path: '/dashboard/on-this-day',
      expectedHeading: 'On this day',
      readySelector: '[data-rediscovery-state="ready"]',
    },
    {
      name: 'on-this-day-anniversary',
      path: '/dashboard/on-this-day?date=2026-09-15',
      expectedHeading: 'On this day',
      readySelector: '[data-rediscovery-state="ready"]',
    },
    {
      name: 'on-this-day-recent',
      path: '/dashboard/on-this-day?date=2026-01-02',
      expectedHeading: 'On this day',
      expectedSelector: '[data-memory-grid="recent"] article:nth-child(2)',
      readySelector: '[data-rediscovery-mode="recent"]',
    },
    {
      name: 'chapters',
      path: '/dashboard/chapters',
      expectedHeading: 'My Journeys.',
    },
    {
      name: 'chapter',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}`,
      expectedSelector: '[aria-label="Journey actions"]',
      readyButton: 'Show route map',
      readySelector: 'button[aria-label^="Stop 1:"]',
    },
    {
      name: 'chapter-edit',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}/edit`,
      expectedHeading: 'Shape your journey.',
    },
    {
      name: 'chapter-new',
      path: '/dashboard/chapters/new',
      expectedHeading: 'Begin a new journey.',
    },
    {
      name: 'journey-arrange',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}/edit?step=arrange`,
      expectedHeading: 'Shape your journey.',
      expectedSelector: '[data-editor-step="arrange"]',
    },
    {
      name: 'memory-card',
      path: `/dashboard/card/${encodeURIComponent(e2eEntryId)}`,
      expectedHeading: 'Keep the feeling close.',
    },
    {
      name: 'security',
      path: '/dashboard/security',
      expectedHeading: /^(?:Account & security|Security)\.$/,
    },
    {
      name: 'legacy-users',
      path: '/dashboard/users',
      expectedHeading: 'Your collection.',
      expectedPath: '/dashboard/places',
    },
    {
      name: 'legacy-journal',
      path: '/dashboard/journal',
      expectedHeading: 'Your collection.',
      expectedPath: '/dashboard/places',
    },
  ];
  const viewports = auditedViewports(testInfo);

  for (const route of routes) {
    for (const viewport of viewports) {
      await applyViewport(page, viewport);
      await openAndAudit(
        page,
        testInfo,
        route.path,
        `${route.name}-${viewport.name}-${testInfo.project.name}`,
        monitor,
        {
          accessibility: shouldRunAccessibilityAudit(testInfo, viewport),
          expectedHeading: route.expectedHeading,
          expectedPath: route.expectedPath,
          expectedSelector: route.expectedSelector,
          expectedStatus: 200,
          readyButton: route.readyButton,
          readySelector: route.readySelector,
        },
      );
      if (
        route.name === 'on-this-day-recent' &&
        (await page.locator('[data-memory-grid="recent"]').count()) > 0
      ) {
        const heights = await page
          .locator('[data-memory-grid="recent"] > article')
          .evaluateAll((cards) =>
            cards.map((card) => card.getBoundingClientRect().height),
          );
        expect(heights.length).toBeGreaterThanOrEqual(2);
        expect(Math.min(...heights)).toBeGreaterThan(0);
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(
          1,
        );
      }
    }
  }

  if (!isMobileProject(testInfo)) {
    await page.setViewportSize({ width: 320, height: 568 });
  }
  await page.goto('/dashboard/on-this-day');
  await expect(page.locator('[data-rediscovery-state="ready"]')).toBeVisible();
  const anniversaryCandidate = await page
    .locator('article')
    .evaluateAll((cards) => {
      const today = new Date();
      const todayDate = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');

      for (const card of cards) {
        const memoryDate = card.querySelector('time')?.getAttribute('datetime');
        const memoryLink = card.querySelector<HTMLAnchorElement>(
          'a[href^="/dashboard/card/"]',
        );
        if (!memoryDate || !memoryLink) continue;

        const monthAndDay = memoryDate.slice(5);
        const selectedYear =
          monthAndDay <= todayDate.slice(5)
            ? today.getFullYear()
            : today.getFullYear() - 1;
        if (selectedYear <= Number(memoryDate.slice(0, 4))) continue;

        return {
          href: memoryLink.getAttribute('href'),
          selectedDate: `${selectedYear}-${monthAndDay}`,
        };
      }

      return null;
    });
  expect(
    anniversaryCandidate,
    'The populated UI account needs a dated memory from an earlier year.',
  ).not.toBeNull();
  if (!anniversaryCandidate?.href) {
    throw new Error(
      'Could not derive an anniversary from the populated account.',
    );
  }
  const previousDate = new Date(
    `${anniversaryCandidate.selectedDate}T12:00:00Z`,
  );
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previousDateValue = previousDate.toISOString().slice(0, 10);

  await page
    .getByLabel('Choose a date', { exact: true })
    .fill(anniversaryCandidate.selectedDate);
  await page
    .getByRole('button', { name: 'Find memories', exact: true })
    .click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/on-this-day' &&
      url.searchParams.get('date') === anniversaryCandidate.selectedDate
    );
  });
  await expect(
    page.locator('[data-rediscovery-state="ready"]'),
  ).toHaveAttribute('data-rediscovery-mode', 'anniversary');
  await expect(
    page.locator(`a[href="${anniversaryCandidate.href}"]`).first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Previous day', exact: true }).click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/on-this-day' &&
      url.searchParams.get('date') === previousDateValue
    );
  });
  await expect(page.locator('[data-rediscovery-state="ready"]')).toBeVisible();
  await auditCurrentPage(
    page,
    testInfo,
    `on-this-day-date-selection-${isMobileProject(testInfo) ? 'native' : 'small-phone'}-${testInfo.project.name}`,
    monitor,
    {
      accessibility:
        testInfo.project.name === 'chromium' ||
        testInfo.project.name === 'mobile-chromium',
    },
  );
  await page.getByRole('link', { name: 'Next day', exact: true }).click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/on-this-day' &&
      url.searchParams.get('date') === anniversaryCandidate.selectedDate
    );
  });
  await expect(
    page.locator('[data-rediscovery-state="ready"]'),
  ).toHaveAttribute('data-rediscovery-mode', 'anniversary');
  await expect(
    page.locator(`a[href="${anniversaryCandidate.href}"]`).first(),
  ).toBeVisible();

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open memory list' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your memories' }),
  ).toBeVisible();
  await auditCurrentPage(
    page,
    testInfo,
    `atlas-memory-list-${isMobileProject(testInfo) ? 'native' : 'small-phone'}-${testInfo.project.name}`,
    monitor,
    {
      accessibility: testInfo.project.name === 'chromium',
      readySelector: '[data-map-state="ready"]',
    },
  );

  const uploadViewports = isMobileProject(testInfo)
    ? nativeMobileViewport
    : [
        { name: 'small-phone', width: 320, height: 568 },
        { name: 'desktop', width: 1440, height: 900 },
      ];

  for (const viewport of uploadViewports) {
    await applyViewport(page, viewport);
    // A cold desktop browser can paint the server-rendered picker just before
    // React attaches its change handler. Network idle is the observable point
    // at which the upload surface is ready for an immediate automated selection.
    await page.goto('/dashboard/import', { waitUntil: 'networkidle' });
    const chooser = page.locator('input[type="file"]').first();
    await chooser.setInputFiles([
      path.join(fixtureRoot, 'riverwalk-test.png'),
      path.join(fixtureRoot, 'kyoto-test.png'),
    ]);
    await expect(page.getByText('2 photos selected')).toBeVisible({
      timeout: 20_000,
    });
    await auditCurrentPage(
      page,
      testInfo,
      `upload-selection-${viewport.name}-${testInfo.project.name}`,
      monitor,
      {
        accessibility: testInfo.project.name === 'chromium',
      },
    );
    await page.getByRole('button', { name: 'Review 2 photos' }).click();
    await expect(
      page.getByRole('heading', { name: /2 memories across the map/i }),
    ).toBeVisible();
    await auditCurrentPage(
      page,
      testInfo,
      `upload-review-${viewport.name}-${testInfo.project.name}`,
      monitor,
      {
        accessibility: testInfo.project.name === 'chromium',
        readySelector: '[data-map-state="ready"]',
      },
    );
  }

  monitor.stop();
});
