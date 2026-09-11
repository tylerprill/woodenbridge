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
}

test('authenticated routes and primary interactions pass the UI audit', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const monitor = monitorBrowserIssues(page);
  await signIn(page);

  const routes: AuthenticatedRoute[] = [
    {
      name: 'atlas',
      path: '/dashboard',
      expectedHeading: /world$/,
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
      name: 'chapters',
      path: '/dashboard/chapters',
      expectedHeading: 'My Chapters.',
    },
    {
      name: 'chapter',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}`,
      expectedSelector: '[aria-label="Chapter actions"]',
    },
    {
      name: 'chapter-edit',
      path: `/dashboard/chapters/${encodeURIComponent(e2eChapterId)}/edit`,
      expectedHeading: 'Shape your chapter.',
    },
    {
      name: 'chapter-new',
      path: '/dashboard/chapters/new',
      expectedHeading: 'Begin a new chapter.',
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
        },
      );
    }
  }

  if (!isMobileProject(testInfo)) {
    await page.setViewportSize({ width: 320, height: 568 });
  }
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open memory list' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your memories' }),
  ).toBeVisible();
  await auditCurrentPage(page, testInfo, 'atlas-memory-list-mobile', monitor, {
    accessibility: testInfo.project.name === 'chromium',
  });

  await page.goto('/dashboard/import');
  const chooser = page.locator('input[type="file"]').first();
  await chooser.setInputFiles([
    path.join(fixtureRoot, 'riverwalk-test.png'),
    path.join(fixtureRoot, 'kyoto-test.png'),
  ]);
  await expect(page.getByText('2 photos selected')).toBeVisible({
    timeout: 20_000,
  });
  await auditCurrentPage(page, testInfo, 'upload-selection-mobile', monitor, {
    accessibility: testInfo.project.name === 'chromium',
  });
  await page.getByRole('button', { name: 'Review 2 photos' }).click();
  await expect(
    page.getByRole('heading', { name: /2 memories across the map/i }),
  ).toBeVisible();
  await auditCurrentPage(page, testInfo, 'upload-review-mobile', monitor, {
    accessibility: testInfo.project.name === 'chromium',
  });

  monitor.stop();
});
