import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import {
  auditCurrentPage,
  monitorBrowserIssues,
  openAndAudit,
} from './support/ui-audit';

type AuditViewport = {
  name: string;
  width?: number;
  height?: number;
};

type PublicRoute = {
  expectedHeading?: string | RegExp;
  expectedSelector?: string;
  name: string;
  path: string;
  status: number;
};

const sharedChapterId = process.env.E2E_SHARED_CHAPTER_ID?.trim();
const sharedChapterPath = sharedChapterId
  ? `/shared/chapters/${encodeURIComponent(sharedChapterId)}`
  : null;

const compactLoginViewport = { width: 393, height: 659 } as const;
// This is Playwright's iPhone 15 landscape content viewport. Keeping the
// dimensions explicit makes the fold regression identical in every project.
const compactSharedLandscapeViewport = { width: 734, height: 343 } as const;

const publicRoutes: PublicRoute[] = [
  {
    name: 'landing',
    path: '/',
    status: 200,
    expectedHeading: /Your camera roll/,
  },
  {
    name: 'login',
    path: '/login',
    status: 200,
    expectedHeading: 'Sign in to continue',
  },
  {
    name: 'sign-up',
    path: '/sign-up',
    status: 200,
    expectedHeading: 'Create your account',
  },
  {
    name: 'forgot-password',
    path: '/forgot-password',
    status: 200,
    expectedHeading: 'Reset your password',
  },
  {
    name: 'verify-email restart',
    path: '/verify-email',
    status: 200,
    expectedHeading: 'Verify your email',
  },
  {
    name: 'invalid reset token',
    path: '/reset-password?token=not-a-real-reset-token',
    status: 200,
    expectedHeading: 'The trail has gone cold',
  },
  ...(sharedChapterPath
    ? [
        {
          name: 'shared chapter',
          path: sharedChapterPath,
          status: 200,
          expectedSelector: '.shared-chapter-page .keepsake-card-row',
        },
      ]
    : []),
  {
    name: 'not found',
    path: '/route-that-does-not-exist',
    status: 404,
    expectedHeading: 'This path is not in the atlas.',
  },
];

const chromiumViewports: AuditViewport[] = [
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'large-phone', width: 430, height: 932 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'large-desktop', width: 1920, height: 1080 },
];

const crossBrowserViewports: AuditViewport[] = [
  { name: 'desktop', width: 1440, height: 900 },
];

const nativeMobileViewport: AuditViewport[] = [{ name: 'native' }];

function isMobileProject(testInfo: TestInfo) {
  return testInfo.project.name.startsWith('mobile-');
}

function auditedViewports(testInfo: TestInfo) {
  if (isMobileProject(testInfo)) return nativeMobileViewport;
  return testInfo.project.name === 'chromium'
    ? chromiumViewports
    : crossBrowserViewports;
}

async function applyViewport(page: Page, viewport: AuditViewport) {
  if (viewport.width && viewport.height) {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });
  }
}

async function expectInsideInitialViewport(
  page: Page,
  target: Locator,
  label: string,
) {
  await expect(target).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  const viewport = page.viewportSize();
  const box = await target.boundingBox();
  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));

  expect(viewport, `${label}: browser viewport`).not.toBeNull();
  expect(box, `${label}: bounding box`).not.toBeNull();
  if (!viewport || !box) return;

  expect.soft(scroll, `${label}: initial scroll position`).toEqual({
    x: 0,
    y: 0,
  });
  expect
    .soft(box.height, `${label}: touch target height`)
    .toBeGreaterThanOrEqual(44);
  expect.soft(box.x, `${label}: left edge`).toBeGreaterThanOrEqual(0);
  expect.soft(box.y, `${label}: top edge`).toBeGreaterThanOrEqual(0);
  expect
    .soft(box.x + box.width, `${label}: right edge within ${viewport.width}px`)
    .toBeLessThanOrEqual(viewport.width);
  expect
    .soft(
      box.y + box.height,
      `${label}: bottom edge within ${viewport.height}px`,
    )
    .toBeLessThanOrEqual(viewport.height);
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

for (const route of publicRoutes) {
  test(`${route.name} is stable across audited viewports`, async ({
    page,
  }, testInfo) => {
    const monitor = monitorBrowserIssues(page);
    const viewports = auditedViewports(testInfo);

    for (const viewport of viewports) {
      await test.step(viewport.name, async () => {
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
            expectedSelector: route.expectedSelector,
            expectedStatus: route.status,
          },
        );
      });
    }

    monitor.stop();
  });
}

test('landing navigation preserves the photo-import intent', async ({
  page,
}, testInfo) => {
  const monitor = monitorBrowserIssues(page);
  if (!isMobileProject(testInfo)) {
    await page.setViewportSize({ width: 320, height: 568 });
  }
  await page.goto('/');
  await page
    .getByRole('link', { name: /upload/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/sign-up\?intent=photo-import$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Create your account' }),
  ).toBeVisible();
  await auditCurrentPage(
    page,
    testInfo,
    `landing-upload-cta-${testInfo.project.name}`,
    monitor,
    { accessibility: testInfo.project.name === 'chromium' },
  );
  monitor.stop();
});

test('landing skip link focuses the primary content', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  // Safari on macOS uses Option+Tab for link navigation unless the user has
  // enabled full keyboard access. Chromium and Firefox use Tab directly.
  await page.keyboard.press(
    testInfo.project.name.includes('webkit') ? 'Alt+Tab' : 'Tab',
  );
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await expect(skipLink).toBeFocused();
  await skipLink.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('login submit fits the compact portrait first fold', async ({ page }) => {
  await page.setViewportSize(compactLoginViewport);
  await page.goto('/login');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to continue' }),
  ).toBeVisible();

  await expectInsideInitialViewport(
    page,
    page.getByRole('button', { name: /^sign in$/i }),
    `login submit at ${compactLoginViewport.width}x${compactLoginViewport.height}`,
  );
});

test('shared chapter CTA fits the iPhone 15 landscape first fold', async ({
  page,
}) => {
  test.skip(
    !sharedChapterPath,
    'Set E2E_SHARED_CHAPTER_ID to audit the shared chapter first fold.',
  );
  if (!sharedChapterPath) return;

  await page.setViewportSize(compactSharedLandscapeViewport);
  await page.goto(sharedChapterPath);
  await expect(page).toHaveURL((url) => url.pathname === sharedChapterPath);
  await expect(page.locator('.shared-chapter-page')).toBeVisible();

  await expectInsideInitialViewport(
    page,
    page.getByRole('link', { name: 'Begin the journey', exact: true }),
    `shared chapter CTA at ${compactSharedLandscapeViewport.width}x${compactSharedLandscapeViewport.height}`,
  );
});

test('shared chapter reveals its route map and every memory', async ({
  page,
}, testInfo) => {
  test.skip(
    !sharedChapterPath,
    'Set E2E_SHARED_CHAPTER_ID to audit a seeded shared chapter.',
  );
  if (!sharedChapterPath) return;

  // Keep the optional manual control mounted for this interaction test. The
  // viewport matrix exercises IntersectionObserver auto-loading separately;
  // here, scrolling the control into view would otherwise auto-load the map
  // and detach the button before Playwright can perform a real click.
  await page.addInitScript(() => {
    class ManualMapIntersectionObserver {
      readonly root = null;
      readonly rootMargin = '0px';
      readonly thresholds: number[] = [];

      disconnect() {}
      observe() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve() {}
    }

    window.IntersectionObserver =
      ManualMapIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  const monitor = monitorBrowserIssues(page);
  await page.goto(sharedChapterPath);
  const memoryCards = page.locator('.keepsake-card-row');
  const memoryCount = await memoryCards.count();
  expect(memoryCount, 'shared chapter fixture memories').toBeGreaterThan(0);
  const showMap = page.getByRole('button', { name: 'Show route map' });
  await expect(showMap).toBeAttached();
  await showMap.scrollIntoViewIfNeeded();
  await expect(showMap).toBeVisible();
  await showMap.click();

  const mapRegion = page.getByRole('region', {
    name: `Map of ${memoryCount} ordered chapter memories`,
  });
  await expect(mapRegion).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Route map unavailable' }),
  ).toHaveCount(0);

  const canvas = mapRegion.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const canvasSize = await canvas.evaluate((element) => ({
    height: element.clientHeight,
    width: element.clientWidth,
  }));
  expect(canvasSize.width, 'route map canvas width').toBeGreaterThan(200);
  expect(canvasSize.height, 'route map canvas height').toBeGreaterThan(150);

  const markers = mapRegion.getByRole('button', { name: /^Stop \d+:/ });
  await expect(markers).toHaveCount(memoryCount, { timeout: 20_000 });
  const firstMarker = markers.first();
  await firstMarker.focus();
  await expect(firstMarker).toBeFocused();
  await expect(page.locator('.chapter-map-popup')).toContainText('Stop 1');
  await auditCurrentPage(
    page,
    testInfo,
    `shared-chapter-map-${testInfo.project.name}`,
    monitor,
    { accessibility: testInfo.project.name === 'chromium' },
  );
  monitor.stop();
});

async function measureAuthLayout(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.auth-panel');
    const submit = document.querySelector<HTMLElement>(
      '.auth-panel button[type="submit"]',
    );
    if (!panel || !submit) throw new Error('Auth form layout was not found.');

    const measure = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
      };
    };

    return {
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      panel: measure(panel),
      submit: measure(submit),
    };
  });
}

function expectStableLayout(
  before: Awaited<ReturnType<typeof measureAuthLayout>>,
  after: Awaited<ReturnType<typeof measureAuthLayout>>,
  label: string,
) {
  const measurements = [
    ['document height', before.documentHeight, after.documentHeight],
    ['document width', before.documentWidth, after.documentWidth],
    ['panel height', before.panel.height, after.panel.height],
    ['panel left', before.panel.left, after.panel.left],
    ['panel top', before.panel.top, after.panel.top],
    ['panel width', before.panel.width, after.panel.width],
    ['submit height', before.submit.height, after.submit.height],
    ['submit left', before.submit.left, after.submit.left],
    ['submit top', before.submit.top, after.submit.top],
    ['submit width', before.submit.width, after.submit.width],
  ] as const;

  for (const [measurement, expected, actual] of measurements) {
    expect
      .soft(Math.abs(actual - expected), `${label}: ${measurement} shifted`)
      .toBeLessThanOrEqual(2);
  }
}

test('public forms expose native validation without shifting the page', async ({
  page,
}, testInfo) => {
  const monitor = monitorBrowserIssues(page);
  const forms = [
    { path: '/login', button: /sign in/i },
    { path: '/sign-up', button: /create account/i },
    { path: '/forgot-password', button: /send reset link/i },
  ];

  for (const form of forms) {
    if (!isMobileProject(testInfo)) {
      await page.setViewportSize({ width: 320, height: 568 });
    }
    await page.goto(form.path);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const before = await measureAuthLayout(page);
    await page.getByRole('button', { name: form.button }).click();
    const invalidControls = page.locator(
      'input:invalid, select:invalid, textarea:invalid',
    );
    const invalidCount = await invalidControls.count();
    expect
      .soft(invalidCount, `${form.path}: invalid controls`)
      .toBeGreaterThan(0);
    await expect
      .soft(
        invalidControls.first(),
        `${form.path}: first invalid control focus`,
      )
      .toBeFocused();
    const after = await measureAuthLayout(page);
    expectStableLayout(before, after, form.path);
    await auditCurrentPage(
      page,
      testInfo,
      `${form.path}-validation-${testInfo.project.name}`,
      monitor,
    );
  }
  monitor.stop();
});

test('anonymous users are guarded from every private route', async ({
  page,
}, testInfo) => {
  const privateRoutes = [
    '/dashboard',
    '/dashboard/import',
    '/dashboard/places',
    '/dashboard/card/not-a-real-entry',
    '/dashboard/chapters',
    '/dashboard/chapters/new',
    '/dashboard/chapters/not-a-real-chapter',
    '/dashboard/chapters/not-a-real-chapter/edit',
    '/dashboard/security',
    '/dashboard/owner/users',
    '/dashboard/users',
    '/dashboard/journal',
  ];
  const monitor = monitorBrowserIssues(page);

  for (const path of privateRoutes) {
    await page.goto(path);
    await expect.soft(page, `${path}: redirect path`).toHaveURL((url) => {
      if (url.pathname !== '/login') return false;
      const callback = url.searchParams.get('callbackUrl');
      if (!callback) return false;
      return new URL(callback, url.origin).pathname === path;
    });
    await expect
      .soft(
        page.getByRole('heading', {
          level: 1,
          name: 'Sign in to continue',
        }),
        `${path}: guarded login content`,
      )
      .toBeVisible();
  }

  await auditCurrentPage(
    page,
    testInfo,
    `private-route-guard-${testInfo.project.name}`,
    monitor,
  );
  monitor.stop();
});

const seamRoutes = [
  {
    expectedHeading: /Your camera roll/,
    name: 'landing',
    path: '/',
    widths: [
      360, 361, 520, 521, 641, 642, 720, 721, 900, 901, 947, 948, 1100, 1101,
    ],
  },
  {
    expectedHeading: 'Sign in to continue',
    name: 'login',
    path: '/login',
    widths: [520, 521, 760, 761, 900, 901, 1120, 1121],
  },
] as const;

for (const route of seamRoutes) {
  test(`${route.name} breakpoint seams do not overflow`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');

    const monitor = monitorBrowserIssues(page);
    for (const width of route.widths) {
      await page.setViewportSize({ width, height: width >= 800 ? 700 : 844 });
      await openAndAudit(
        page,
        testInfo,
        route.path,
        `${route.name}-seam-${width}`,
        monitor,
        {
          expectedHeading: route.expectedHeading,
          expectedStatus: 200,
          screenshot: false,
        },
      );
    }
    monitor.stop();
  });
}
