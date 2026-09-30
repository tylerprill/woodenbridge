import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { Client } from 'pg';

import { monitorBrowserIssues } from './support/ui-audit';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const currentLocation = {
  latitude: 39.7392,
  longitude: -104.9903,
};

type AtlasPreference = {
  latitude: number | string;
  longitude: number | string;
  zoom: number | string;
  bearing: number | string;
  pitch: number | string;
};

function e2eDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    const connection = new URL(connectionString);
    const overridesHost = Array.from(connection.searchParams.keys()).some(
      (key) => key.toLowerCase() === 'host',
    );
    if (
      !['postgres:', 'postgresql:'].includes(connection.protocol) ||
      !loopbackHosts.has(connection.hostname.toLowerCase()) ||
      connection.pathname !== '/field_atlas_e2e' ||
      overridesHost
    ) {
      return null;
    }
    return connectionString;
  } catch {
    return null;
  }
}

async function withE2EDatabase<T>(run: (client: Client) => Promise<T>) {
  const connectionString = e2eDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'Atlas location smoke is restricted to the loopback field_atlas_e2e database.',
    );
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function removeSavedView(email: string) {
  return withE2EDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      const user = await client.query<{ id: string }>(
        'SELECT id::text FROM users WHERE LOWER(email) = LOWER($1) FOR UPDATE',
        [email],
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error('The E2E Atlas account was not found.');
      const preference = await client.query<AtlasPreference>(
        `SELECT latitude, longitude, zoom, bearing, pitch
         FROM atlas_preferences
         WHERE user_id = $1`,
        [userId],
      );
      await client.query('DELETE FROM atlas_preferences WHERE user_id = $1', [
        userId,
      ]);
      await client.query('COMMIT');
      return { userId, preference: preference.rows[0] ?? null };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function restoreSavedView({
  userId,
  preference,
}: {
  userId: string;
  preference: AtlasPreference | null;
}) {
  await withE2EDatabase(async (client) => {
    await client.query('DELETE FROM atlas_preferences WHERE user_id = $1', [
      userId,
    ]);
    if (!preference) return;
    await client.query(
      `INSERT INTO atlas_preferences (
         user_id, latitude, longitude, zoom, bearing, pitch
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        preference.latitude,
        preference.longitude,
        preference.zoom,
        preference.bearing,
        preference.pitch,
      ],
    );
  });
}

async function expectNoSavedView(userId: string) {
  await withE2EDatabase(async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM atlas_preferences WHERE user_id = $1',
      [userId],
    );
    expect(result.rows[0]?.count).toBe('0');
  });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, {
    timeout: 20_000,
  });
  await page.waitForLoadState('load');
  await page.waitForTimeout(250);
}

async function capture(page: Page, testInfo: TestInfo, label: string) {
  const screenshotPath = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(label, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

const viewports = [
  { label: 'desktop-1440x900', width: 1440, height: 900 },
  { label: 'mobile-portrait-412x915', width: 412, height: 915 },
  { label: 'smallest-portrait-320x568', width: 320, height: 568 },
  { label: 'mobile-landscape-915x412', width: 915, height: 412 },
] as const;

async function auditAtlasViewports(
  page: Page,
  testInfo: TestInfo,
  label: string,
) {
  const atlas = page.locator('[data-map-state="ready"]');
  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await expect(atlas).toBeVisible();
    const filterBar = page.getByRole('group', { name: 'Filter memories' });
    const mobileAtlas =
      viewport.width <= 760 ||
      (viewport.height <= 480 && viewport.width > viewport.height);
    if (mobileAtlas) {
      await expect(filterBar, `${viewport.label}: mobile filters`).toBeHidden();
    } else {
      await expect(
        filterBar,
        `${viewport.label}: desktop filters`,
      ).toBeVisible();
    }
    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect
      .soft(horizontalOverflow, `${viewport.label}: horizontal overflow`)
      .toBeLessThanOrEqual(1);
    const verticalMetrics = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.dashboard-shell');
      const shellBounds = shell?.getBoundingClientRect();
      return {
        documentOverflow:
          Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ) - window.innerHeight,
        shellBottom: shellBounds?.bottom ?? 0,
        shellTop: shellBounds?.top ?? 0,
        viewportHeight: window.innerHeight,
      };
    });
    expect
      .soft(verticalMetrics.documentOverflow, `${viewport.label}: page height`)
      .toBeLessThanOrEqual(1);
    expect
      .soft(verticalMetrics.shellTop, `${viewport.label}: shell top`)
      .toBeCloseTo(0, 0);
    expect
      .soft(
        verticalMetrics.shellBottom,
        `${viewport.label}: shell bottom matches viewport`,
      )
      .toBeCloseTo(verticalMetrics.viewportHeight, 0);
    await capture(page, testInfo, `${label}-${viewport.label}`);
  }
}

test('a fresh Atlas starts near one approximate browser location without saving it', async ({
  context,
  page,
}, testInfo) => {
  const managesSavedView = Boolean(e2eDatabaseUrl());
  const usesProvisionedFreshAccount =
    process.env.E2E_LOCATION_FRESH_ACCOUNT === '1';
  const forcesUnsavedView = process.env.E2E_LOCATION_FORCE_UNSAVED_VIEW === '1';
  test.skip(
    testInfo.project.name !== 'chromium' ||
      (!managesSavedView && !usesProvisionedFreshAccount && !forcesUnsavedView),
    'The location canary runs once with an isolated database, provisioned fresh account, or local response fixture.',
  );
  test.setTimeout(120_000);
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Atlas location smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
    );
  }

  const savedView = managesSavedView ? await removeSavedView(email) : null;
  let unsavedViewReplacements = 0;
  let dashboardServerActions = 0;
  let monitor: ReturnType<typeof monitorBrowserIssues> | null = null;
  try {
    await context.setGeolocation({ ...currentLocation, accuracy: 1_500 });
    await context.grantPermissions(['geolocation'], { origin: baseUrl });
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, email, password);
    if (forcesUnsavedView) {
      await page.route('**/dashboard**', async (route) => {
        if (
          route.request().method() !== 'GET' ||
          new URL(route.request().url()).pathname !== '/dashboard'
        ) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const originalBody = await response.text();
        const body = originalBody.replace(
          /(hasSavedView(?:\\+)?":)true/g,
          (match) => {
            unsavedViewReplacements += 1;
            return match.replace(':true', ':false');
          },
        );
        await route.fulfill({ response, body });
      });
    }
    await page.evaluate(() => window.sessionStorage.clear());
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/dashboard' &&
        request.headers()['next-action']
      ) {
        dashboardServerActions += 1;
      }
    });
    monitor = monitorBrowserIssues(page);
    await page.goto('/dashboard');
    if (forcesUnsavedView) {
      expect(unsavedViewReplacements).toBeGreaterThan(0);
      await page.unroute('**/dashboard**');
    }

    const atlas = page.locator('[data-map-state="ready"]');
    await expect(atlas).toHaveAttribute('data-location-start', 'centered', {
      timeout: 20_000,
    });
    const response = await page.request.get('/dashboard');
    expect(response.headers()['permissions-policy']).toContain(
      'geolocation=(self)',
    );

    await auditAtlasViewports(page, testInfo, 'atlas-location');

    await page.waitForTimeout(1_600);
    expect(dashboardServerActions).toBe(0);
    if (savedView) await expectNoSavedView(savedView.userId);
    expect(monitor.flush()).toEqual([]);
  } finally {
    monitor?.stop();
    if (savedView) await restoreSavedView(savedView);
  }
});

test('a saved Atlas view wins without requesting a fresh location', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The required viewport matrix runs once in Chromium.',
  );
  test.setTimeout(90_000);
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Atlas saved-view smoke requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
    );
  }

  const managesSavedView = Boolean(e2eDatabaseUrl());
  const originalSavedView = managesSavedView
    ? await removeSavedView(email)
    : null;
  if (originalSavedView) {
    await restoreSavedView({
      userId: originalSavedView.userId,
      preference: {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        zoom: 9,
        bearing: 0,
        pitch: 0,
      },
    });
  }
  let monitor: ReturnType<typeof monitorBrowserIssues> | null = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, email, password);
    if (!managesSavedView) {
      await page.route('**/dashboard**', async (route) => {
        if (
          route.request().method() !== 'GET' ||
          new URL(route.request().url()).pathname !== '/dashboard'
        ) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const body = (await response.text()).replace(
          /(hasSavedView(?:\\+)?":)false/g,
          (match) => match.replace(':false', ':true'),
        );
        await route.fulfill({ response, body });
      });
    }
    monitor = monitorBrowserIssues(page);
    await page.goto('/dashboard');
    if (!managesSavedView) await page.unroute('**/dashboard**');
    const atlas = page.locator('[data-map-state="ready"]');
    await expect(atlas).toHaveAttribute('data-location-start', 'disabled', {
      timeout: 20_000,
    });
    const response = await page.request.get('/dashboard');
    expect(response.headers()['permissions-policy']).toContain(
      'geolocation=(self)',
    );
    await auditAtlasViewports(page, testInfo, 'atlas-saved-view');
    expect(monitor.flush()).toEqual([]);
  } finally {
    monitor?.stop();
    if (originalSavedView) await restoreSavedView(originalSavedView);
  }
});
