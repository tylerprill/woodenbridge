import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { E2E_FIXTURE } from '../scripts/seed-e2e.js';
import {
  auditCurrentPage,
  monitorBrowserIssues,
  openAndAudit,
} from './support/ui-audit';

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

async function auditMemoryActions(
  page: Page,
  testInfo: TestInfo,
  monitor: ReturnType<typeof monitorBrowserIssues>,
  {
    accessibility,
    deleteButton,
    editLink,
    expectedEditHref,
    label,
    scope,
  }: {
    accessibility: boolean;
    deleteButton: Locator;
    editLink: Locator;
    expectedEditHref: string;
    label: string;
    scope: Locator;
  },
) {
  await expect(editLink, `${label}: edit control`).toBeVisible();
  await expect(editLink, `${label}: edit destination`).toHaveAttribute(
    'href',
    expectedEditHref,
  );
  await editLink.click({ trial: true });

  await expect(deleteButton, `${label}: delete control`).toBeVisible();
  const startingUrl = page.url();
  await deleteButton.click();
  await expect(
    page,
    `${label}: opening delete confirmation stays in place`,
  ).toHaveURL(startingUrl);

  const confirmation = scope.getByRole('alertdialog');
  const keepButton = confirmation.getByRole('button', {
    name: 'Keep memory',
    exact: true,
  });
  const confirmButton = confirmation.getByRole('button', {
    name: /^Delete .+ permanently$/,
  });
  await expect(confirmation, `${label}: confirmation`).toBeVisible();
  await expect(confirmation).toContainText('Delete this memory?');
  await expect(confirmation).toContainText(
    'It disappears from journeys, and its photos are deleted. This can’t be undone.',
  );
  await expect(
    confirmButton,
    `${label}: destructive confirmation`,
  ).toBeEnabled();
  await expect(
    keepButton,
    `${label}: safe action receives focus`,
  ).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(
    confirmation,
    `${label}: Escape closes confirmation`,
  ).toBeHidden();
  await expect(
    deleteButton,
    `${label}: Escape restores delete-trigger focus`,
  ).toBeFocused();

  await deleteButton.click();
  await expect(confirmation).toBeVisible();
  await auditCurrentPage(page, testInfo, label, monitor, { accessibility });

  await keepButton.click();
  await expect(
    confirmation,
    `${label}: keep memory cancels deletion`,
  ).toBeHidden();
  await expect(
    deleteButton,
    `${label}: cancel restores delete-trigger focus`,
  ).toBeFocused();
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
      name: 'places',
      path: '/dashboard/places',
      expectedHeading: 'Memories.',
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
      expectedSelector: `[data-rediscovery-mode="anniversary"] a[href="/dashboard/card/${E2E_FIXTURE.entryIds[1]}"]`,
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
      expectedHeading: 'Journeys.',
    },
    {
      name: 'chapter',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}`,
      expectedSelector: '[aria-label="Journey actions"]',
      readyButton: 'Show route map',
      readySelector: 'button[data-chapter-marker="true"]',
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
      expectedHeading: 'Security.',
    },
    {
      name: 'legacy-users',
      path: '/dashboard/users',
      expectedHeading: 'Memories.',
      expectedPath: '/dashboard/places',
    },
    {
      name: 'legacy-journal',
      path: '/dashboard/journal',
      expectedHeading: 'Memories.',
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
      if (route.name === 'on-this-day-recent') {
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

      if (route.name === 'places') {
        const card = page
          .locator('.collection-grid > article[data-has-actions="true"]')
          .first();
        const memoryLink = card.locator('a.keepsake-card-link').first();
        await expect(card, 'places: actionable memory card').toBeVisible();
        const memoryHref = await memoryLink.getAttribute('href');
        expect(memoryHref, 'places: memory-card destination').toMatch(
          /^\/dashboard\/card\/[0-9a-f-]+$/,
        );
        if (!memoryHref) {
          throw new Error('The populated collection needs a memory-card link.');
        }
        const memoryId = memoryHref.slice('/dashboard/card/'.length);
        const actionScope = card.locator('[data-memory-actions="card"]');
        await auditMemoryActions(page, testInfo, monitor, {
          accessibility: shouldRunAccessibilityAudit(testInfo, viewport),
          deleteButton: actionScope.getByRole('button', {
            name: /^Delete /,
          }),
          editLink: actionScope.getByRole('link', { name: /^Edit / }),
          expectedEditHref: `/dashboard?memory=${encodeURIComponent(memoryId)}`,
          label: `places-delete-confirmation-${viewport.name}-${testInfo.project.name}`,
          scope: actionScope,
        });
      }

      if (route.name === 'memory-card') {
        const actionScope = page.locator('.keepsake-page-actions');
        await auditMemoryActions(page, testInfo, monitor, {
          accessibility: shouldRunAccessibilityAudit(testInfo, viewport),
          deleteButton: actionScope.getByRole('button', {
            name: 'Delete memory',
            exact: true,
          }),
          editLink: actionScope.getByRole('link', {
            name: 'Edit memory',
            exact: true,
          }),
          expectedEditHref: `/dashboard?memory=${encodeURIComponent(e2eEntryId)}`,
          label: `memory-card-delete-confirmation-${viewport.name}-${testInfo.project.name}`,
          scope: actionScope,
        });
      }
    }
  }

  if (!isMobileProject(testInfo)) {
    await page.setViewportSize({ width: 320, height: 568 });
  }
  await page.goto('/dashboard/on-this-day');
  await expect(page.locator('[data-rediscovery-state="ready"]')).toBeVisible();
  await page.getByLabel('Choose a date', { exact: true }).fill('2026-09-15');
  await page
    .getByRole('button', { name: 'Find memories', exact: true })
    .click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/on-this-day' &&
      url.searchParams.get('date') === '2026-09-15'
    );
  });
  await expect(
    page.locator('[data-rediscovery-state="ready"]'),
  ).toHaveAttribute('data-rediscovery-mode', 'anniversary');
  await expect(
    page.getByRole('heading', {
      name: 'Bikes beneath the Belle Isle trees',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(`a[href="/dashboard/card/${E2E_FIXTURE.entryIds[1]}"]`)
      .first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Previous day', exact: true }).click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/dashboard/on-this-day' &&
      url.searchParams.get('date') === '2026-09-14'
    );
  });
  await expect(
    page.locator('[data-rediscovery-state="ready"]'),
  ).toHaveAttribute('data-rediscovery-mode', 'anniversary');
  await expect(
    page.getByRole('heading', {
      name: 'Morning along the Detroit RiverWalk',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(`a[href="/dashboard/card/${E2E_FIXTURE.entryIds[0]}"]`)
      .first(),
  ).toBeVisible();
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
      url.searchParams.get('date') === '2026-09-15'
    );
  });
  await expect(
    page.locator('[data-rediscovery-state="ready"]'),
  ).toHaveAttribute('data-rediscovery-mode', 'anniversary');
  await expect(
    page.getByRole('heading', {
      name: 'Bikes beneath the Belle Isle trees',
      exact: true,
    }),
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

  monitor.stop();
});

test('removed dashboard routes return the authenticated 404', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required removed-route viewport matrix runs once in Chromium.',
  );
  test.setTimeout(120_000);
  await signIn(page);
  const monitor = monitorBrowserIssues(page);
  const viewports = [
    { name: 'desktop-1440x900', width: 1440, height: 900 },
    { name: 'mobile-portrait-412x915', width: 412, height: 915 },
    { name: 'smallest-portrait-320x568', width: 320, height: 568 },
    { name: 'mobile-landscape-915x412', width: 915, height: 412 },
  ];
  const removedRoutes = [
    { name: 'adventures', path: '/dashboard/adventures' },
    {
      name: 'bulk-import',
      path: '/dashboard/import?source=legacy-bookmark#resume',
    },
  ];

  for (const route of removedRoutes) {
    for (const viewport of viewports) {
      await applyViewport(page, viewport);
      const auditedRoute = new URL(route.path, 'http://field-atlas.test');
      auditedRoute.searchParams.set('audit-viewport', viewport.name);
      await openAndAudit(
        page,
        testInfo,
        `${auditedRoute.pathname}${auditedRoute.search}${auditedRoute.hash}`,
        `removed-${route.name}-${viewport.name}`,
        monitor,
        {
          accessibility:
            viewport.name === 'desktop-1440x900' ||
            viewport.name === 'smallest-portrait-320x568',
          expectedHeading: 'This path is not in the atlas.',
          expectedStatus: 404,
        },
      );
    }
  }

  monitor.stop();
});
