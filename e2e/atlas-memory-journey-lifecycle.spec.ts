import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  devices,
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { Client } from 'pg';

import {
  E2E_LIFECYCLE_FIXTURE,
  getE2ELifecycleMediaStorageConfiguration,
  getE2ELifecycleSeedConfiguration,
  seedE2ELifecycleDatabase,
} from '../scripts/seed-e2e-lifecycle.js';
import { auditCurrentPage, monitorBrowserIssues } from './support/ui-audit';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const fixtureRoot = path.join(
  process.cwd(),
  'output/uiux-image-upload/test-images',
);
const riverwalkFixture = path.join(fixtureRoot, 'riverwalk-test.png');
const kyotoFixture = path.join(fixtureRoot, 'kyoto-test.png');
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

const memories = [
  {
    date: '2024-05-18',
    file: riverwalkFixture,
    note: 'Morning light moved across the river before the city woke.',
    place: 'Detroit RiverWalk, Detroit, Michigan',
    title: 'River light before breakfast',
  },
  {
    date: '2025-03-09',
    file: kyotoFixture,
    note: 'The stones held the rain and every lantern doubled in the street.',
    place: 'Gion, Kyoto, Japan',
    title: 'Lanterns after the rain',
  },
  {
    date: '2026-07-04',
    file: null,
    note: 'The trail climbed into a quiet line of cloud above the valley.',
    place: 'Black Cloud Trail, Colorado',
    title: 'Cloud line above the trail',
  },
] as const;

type MemoryFixture = (typeof memories)[number];

const createdJourneyTitle = 'Light, rain, and the road between';
const updatedJourneyTitle = 'The long way toward morning';
const journeyIntroduction =
  'A field-tested route through the places that changed the pace of the day.';
const transitionNote =
  'Night rain gave way to a bright river and a slower kind of morning.';

type PersistedMemory = {
  deleted_at: Date | null;
  id: string;
  journey_state: 'visited' | 'want_to_visit';
  media_count: number;
  title: string;
  version: number;
};

type PersistedJourney = {
  cover_entry_title: string | null;
  id: string;
  introduction: string;
  share_id: string;
  share_location_precision: 'approximate' | 'exact';
  share_map: boolean;
  title: string;
  version: number;
  visibility: 'private' | 'shared';
  stops: Array<{
    position: number;
    title: string;
    transition_note: string;
  }>;
};

async function expectSharedJourneyUnavailable(
  request: APIRequestContext,
  url: string,
  privateTitles: string[],
) {
  const response = await request.get(url);
  const body = await response.text();

  // App Router can stream a not-found boundary after committing a 200 shell.
  // The privacy invariant is that no Journey data reaches that shell.
  expect([200, 404]).toContain(response.status());
  for (const title of privateTitles) expect(body).not.toContain(title);
  if (response.status() === 200) expect(body).toMatch(/noindex/i);
}

function isLoopbackOwnedServer() {
  if (process.env.E2E_BASE_URL) return false;
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === 'http:' &&
      loopbackHosts.has(url.hostname.toLowerCase()) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function canRunLifecycleAudit() {
  if (
    !isLoopbackOwnedServer() ||
    process.env.E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem' ||
    process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem' ||
    process.env.E2E_LIFECYCLE_DATABASE_SEED !== '1' ||
    process.env.E2E_LIFECYCLE_TEST_EMAIL !== E2E_LIFECYCLE_FIXTURE.email ||
    !process.env.E2E_LIFECYCLE_TEST_PASSWORD
  ) {
    return false;
  }

  try {
    getE2ELifecycleSeedConfiguration(process.env);
    getE2ELifecycleMediaStorageConfiguration(process.env);
    const runtimeDatabase = new URL(process.env.DATABASE_URL ?? '');
    return (
      loopbackHosts.has(runtimeDatabase.hostname.toLowerCase()) &&
      runtimeDatabase.pathname === `/${E2E_LIFECYCLE_FIXTURE.databaseName}` &&
      !runtimeDatabase.search &&
      !runtimeDatabase.hash
    );
  } catch {
    return false;
  }
}

function requireLifecycleAuditEnvironment() {
  if (process.env.E2E_REQUIRE_LIFECYCLE !== '1') return;
  if (!canRunLifecycleAudit()) {
    throw new Error(
      'The required lifecycle UI audit must own a loopback server, its dedicated database, and its isolated filesystem media root.',
    );
  }
}

async function withLifecycleDatabase<T>(run: (client: Client) => Promise<T>) {
  const configuration = getE2ELifecycleSeedConfiguration(process.env);
  const client = new Client({
    connectionString: configuration.connectionString,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function loadPersistedMemories() {
  return withLifecycleDatabase(async (client) => {
    const result = await client.query<PersistedMemory>(
      `
        SELECT
          entry.id::text,
          entry.title,
          entry.journey_state::text,
          entry.version,
          entry.deleted_at,
          (
            SELECT COUNT(*)::integer
            FROM atlas_media AS media
            WHERE media.entry_id = entry.id
              AND media.user_id = entry.user_id
          ) AS media_count
        FROM atlas_entries AS entry
        WHERE entry.user_id = $1
        ORDER BY entry.created_at
      `,
      [E2E_LIFECYCLE_FIXTURE.userId],
    );
    return result.rows;
  });
}

async function loadPersistedJourney(title?: string) {
  return withLifecycleDatabase(async (client) => {
    const chapterResult = await client.query<Omit<PersistedJourney, 'stops'>>(
      `
        SELECT
          chapter.id::text,
          chapter.title,
          chapter.introduction,
          chapter.version,
          chapter.visibility::text,
          chapter.share_id::text,
          chapter.share_map,
          chapter.share_location_precision::text,
          cover_entry.title AS cover_entry_title
        FROM atlas_chapters AS chapter
        LEFT JOIN atlas_media AS cover
          ON cover.id = chapter.cover_media_id
          AND cover.user_id = chapter.user_id
        LEFT JOIN atlas_entries AS cover_entry
          ON cover_entry.id = cover.entry_id
          AND cover_entry.user_id = cover.user_id
        WHERE chapter.user_id = $1
          AND ($2::text IS NULL OR chapter.title = $2)
        ORDER BY chapter.created_at DESC
        LIMIT 1
      `,
      [E2E_LIFECYCLE_FIXTURE.userId, title ?? null],
    );
    const chapter = chapterResult.rows[0];
    if (!chapter) return null;

    const stops = await client.query<PersistedJourney['stops'][number]>(
      `
        SELECT
          chapter_entry.position,
          chapter_entry.transition_note,
          entry.title
        FROM atlas_chapter_entries AS chapter_entry
        INNER JOIN atlas_entries AS entry
          ON entry.id = chapter_entry.entry_id
          AND entry.user_id = chapter_entry.user_id
        WHERE chapter_entry.chapter_id = $1
          AND chapter_entry.user_id = $2
        ORDER BY chapter_entry.position
      `,
      [chapter.id, E2E_LIFECYCLE_FIXTURE.userId],
    );
    return { ...chapter, stops: stops.rows };
  });
}

async function storedObjectNames() {
  const configuration = getE2ELifecycleMediaStorageConfiguration(process.env);
  const entries = await readdir(configuration.storageRoot, {
    withFileTypes: true,
  });
  expect(entries.every((entry) => entry.isFile())).toBe(true);
  return entries.map((entry) => entry.name).sort();
}

function evidenceLabel(testInfo: TestInfo, state: string) {
  return `memory-journey-lifecycle-${state}-${testInfo.project.name}`;
}

function shouldAuditAccessibility(testInfo: TestInfo) {
  return (
    testInfo.project.name === 'chromium' ||
    testInfo.project.name === 'mobile-chromium'
  );
}

async function auditState(
  page: Page,
  testInfo: TestInfo,
  state: string,
  monitor: ReturnType<typeof monitorBrowserIssues>,
  options: {
    map?: boolean;
    mapTeardown?: boolean;
    readerMap?: boolean;
  } = {},
) {
  await auditCurrentPage(
    page,
    testInfo,
    evidenceLabel(testInfo, state),
    monitor,
    {
      accessibility: shouldAuditAccessibility(testInfo),
      expectedMapTeardown: options.mapTeardown,
      readyButton: options.readerMap ? 'Show route map' : undefined,
      readySelector: options.readerMap
        ? 'button[aria-label^="Stop 1:"]'
        : options.map
          ? '[data-map-state="ready"]'
          : undefined,
    },
  );
}

async function expectInsideViewport(
  page: Page,
  target: Locator,
  label: string,
) {
  await expect(target, `${label}: visible`).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  const viewport = page.viewportSize();
  const box = await target.boundingBox();
  expect(viewport, `${label}: viewport`).not.toBeNull();
  expect(box, `${label}: bounds`).not.toBeNull();
  if (!viewport || !box) return;

  expect.soft(box.height, `${label}: touch height`).toBeGreaterThanOrEqual(44);
  expect.soft(box.x, `${label}: left`).toBeGreaterThanOrEqual(0);
  expect.soft(box.y, `${label}: top`).toBeGreaterThanOrEqual(0);
  expect
    .soft(box.x + box.width, `${label}: right`)
    .toBeLessThanOrEqual(viewport.width);
  expect
    .soft(box.y + box.height, `${label}: bottom`)
    .toBeLessThanOrEqual(viewport.height);
}

async function expectNoOverlap(first: Locator, second: Locator, label: string) {
  const [firstBox, secondBox] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
  ]);
  expect(firstBox, `${label}: first bounds`).not.toBeNull();
  expect(secondBox, `${label}: second bounds`).not.toBeNull();
  if (!firstBox || !secondBox) return;

  const horizontal = Math.max(
    0,
    Math.min(firstBox.x + firstBox.width, secondBox.x + secondBox.width) -
      Math.max(firstBox.x, secondBox.x),
  );
  const vertical = Math.max(
    0,
    Math.min(firstBox.y + firstBox.height, secondBox.y + secondBox.height) -
      Math.max(firstBox.y, secondBox.y),
  );
  expect.soft(horizontal * vertical, `${label}: overlap area`).toBe(0);
}

async function signIn(page: Page) {
  const email = process.env.E2E_LIFECYCLE_TEST_EMAIL;
  const password = process.env.E2E_LIFECYCLE_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error('Lifecycle UI coverage requires its test credentials.');
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|[/?#])/, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
}

async function beginManualMemory(page: Page, index: number) {
  const firstMemory = page.getByRole('button', {
    name: 'Place manually',
    exact: true,
  });
  if (await firstMemory.isVisible()) {
    await firstMemory.click();
  } else {
    await page.getByRole('button', { name: 'Add memory', exact: true }).click();
  }

  const prompt = page.getByRole('region', { name: 'Place a memory' });
  await expect(prompt).toBeVisible();
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Atlas map canvas has no placement bounds.');
  await canvas.click({
    force: true,
    position: {
      x: Math.max(
        16,
        Math.min(bounds.width - 16, bounds.width * (0.3 + index * 0.16)),
      ),
      y: Math.max(
        16,
        Math.min(bounds.height - 16, bounds.height * (0.42 + index * 0.06)),
      ),
    },
  });

  const editor = page.getByRole('dialog', { name: 'Create memory' });
  try {
    await editor.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    await prompt.getByRole('button', { name: 'Use map center' }).click();
    await expect(editor).toBeVisible({ timeout: 20_000 });
  }
  return editor;
}

async function createMemory(page: Page, memory: MemoryFixture, index: number) {
  const editor = await beginManualMemory(page, index);
  const titleField = editor.getByRole('textbox', { name: 'Title' });
  const noteField = editor.getByRole('textbox', { name: 'Field note' });
  await expect(titleField).toBeFocused();
  if (index === 0) {
    await editor.getByRole('button', { name: 'Keep memory' }).click();
    await expect(editor.getByRole('alert')).toContainText(
      'Give this memory a title',
    );
  }

  await titleField.fill(memory.title);
  await editor.getByLabel('Place').fill(memory.place);
  await editor.getByLabel('Date visited').fill(memory.date);
  await noteField.fill(memory.note);
  await expect(titleField).toHaveValue(memory.title);
  await expect(noteField).toHaveValue(memory.note);

  if (memory.file) {
    await editor.locator('input[type="file"]').setInputFiles(memory.file);
    await expect(
      editor.getByText(/1 photo was added (?:and saved )?privately\./i),
    ).toBeVisible({ timeout: 60_000 });
    await expect(editor.locator('figure img')).toHaveCount(1);
  }

  await editor.getByRole('button', { name: 'Keep memory' }).click();
  const savedEditor = page.getByRole('dialog', { name: 'Edit memory' });
  await expect(savedEditor.getByText('Saved to your atlas')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    savedEditor.getByRole('link', { name: 'View keepsake' }),
  ).toBeVisible();
  await savedEditor.getByRole('button', { name: 'Close memory' }).click();
  await expect(savedEditor).toBeHidden();
}

async function openMemory(page: Page, title: string) {
  await page.getByRole('button', { name: 'Open memory list' }).click();
  const tray = page.getByRole('region', { name: 'Your memories' });
  await expect(tray).toBeVisible();
  await tray.getByRole('button', { name: new RegExp(title, 'i') }).click();
  const editor = page.getByRole('dialog', { name: 'Edit memory' });
  await expect(editor).toBeVisible();
  return editor;
}

async function expectPrivateImage(
  page: Page,
  browser: Browser,
  source: string,
) {
  const url = new URL(source, baseUrl).href;
  expect(new URL(url).pathname).toMatch(
    /^\/api\/atlas\/media\/[0-9a-f-]{36}$/i,
  );
  const ownerResponse = await page.context().request.get(url);
  expect(ownerResponse.status()).toBe(200);
  expect(ownerResponse.headers()['cache-control']).toContain('private');
  expect(ownerResponse.headers()['x-content-type-options']).toBe('nosniff');
  expect((await ownerResponse.body()).byteLength).toBeGreaterThan(0);

  const anonymous = await browser.newContext();
  try {
    expect((await anonymous.request.get(url)).status()).toBe(404);
  } finally {
    await anonymous.close();
  }
}

async function createJourney(
  page: Page,
  selectedMemories: readonly MemoryFixture[],
) {
  await page.goto('/dashboard/chapters/new');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Begin a new journey.' }),
  ).toBeVisible();
  await page.getByLabel('Journey title').fill(createdJourneyTitle);
  await page.getByLabel('Journey introduction').fill(journeyIntroduction);
  for (const memory of selectedMemories) {
    await page
      .getByRole('button', { name: `Add ${memory.title}`, exact: true })
      .click();
  }
  await page.getByRole('button', { name: /Arrange & share/i }).click();

  const lastMemory = selectedMemories[selectedMemories.length - 1];
  for (let index = selectedMemories.length - 1; index > 0; index -= 1) {
    await page
      .getByRole('button', {
        name: `Move ${lastMemory.title} earlier`,
        exact: true,
      })
      .click();
  }
  const ordered = [lastMemory, ...selectedMemories.slice(0, -1)];
  await page
    .getByRole('button', { name: 'Add words between these stops' })
    .first()
    .click();
  await page
    .getByRole('textbox', {
      name: new RegExp(
        `^Words between ${ordered[0].title} and ${ordered[1].title}`,
      ),
    })
    .fill(transitionNote);

  const photoMemories = ordered.filter((memory) => memory.file);
  const explicitCover = photoMemories[1] ?? photoMemories[0];
  if (explicitCover) {
    await page
      .getByRole('button', {
        name: `Use ${explicitCover.title} as the journey cover`,
      })
      .click();
  }
  await page.getByLabel(/Anyone with the link/).check();
  await page.getByLabel(/Show exact pin positions/).check();
  return { explicitCover, ordered };
}

async function expectReaderOrder(page: Page, titles: string[]) {
  const timeline = page.getByRole('list', {
    name: 'Journey memories in route order',
  });
  await expect(timeline).toBeVisible();
  await expect(timeline.locator('h3')).toHaveText(titles);
}

async function removeMemory(page: Page, title: string, removePhoto = false) {
  const editor = await openMemory(page, title);
  if (removePhoto) {
    await editor.getByRole('button', { name: 'Remove photo' }).click();
    await editor.getByRole('button', { name: 'Confirm remove photo' }).click();
    await expect(
      editor.getByText(/Photo removed|photo was removed/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(editor.locator('figure img')).toHaveCount(0);
  }
  await editor.getByRole('button', { name: 'Remove', exact: true }).click();
  await editor.getByRole('button', { name: 'Remove this memory?' }).click();
  await expect(editor).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('status')).toContainText(
    'Memory removed from your atlas.',
  );
}

test.beforeEach(async () => {
  if (canRunLifecycleAudit()) await seedE2ELifecycleDatabase(process.env);
});

test.afterEach(async ({ page }) => {
  if (!canRunLifecycleAudit()) return;
  await Promise.all(
    page
      .context()
      .pages()
      .map(async (ownerPage) => {
        await ownerPage.unrouteAll({ behavior: 'wait' }).catch(() => undefined);
        await ownerPage.close().catch(() => undefined);
      }),
  );
  await seedE2ELifecycleDatabase(process.env);
});

test('fresh-account actions remain usable across short desktop and exact mobile viewports', async ({
  page,
}, testInfo) => {
  requireLifecycleAuditEnvironment();
  test.skip(
    !canRunLifecycleAudit() || testInfo.project.name !== 'chromium',
    'The responsive fresh-account audit runs once in Chromium against its dedicated lifecycle database.',
  );
  test.setTimeout(240_000);

  await signIn(page);
  const monitor = monitorBrowserIssues(page);
  const atlasViewports = [
    { name: 'short-desktop', width: 1440, height: 600 },
    { name: 'sidebar-breakpoint', width: 1280, height: 600 },
    { name: 'compact-desktop', width: 1024, height: 600 },
    { name: 'height-boundary', width: 901, height: 481 },
    { name: 'smallest-portrait', width: 320, height: 568 },
    { name: 'mobile-landscape', width: 568, height: 320 },
    { name: 'wide-mobile-landscape', width: 844, height: 390 },
  ] as const;

  for (const viewport of atlasViewports) {
    await test.step(`empty Atlas — ${viewport.name}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard');
      await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
        timeout: 20_000,
      });
      const welcomeHeading = page.locator('#empty-atlas-title');
      const compactWelcome =
        viewport.width <= 760 ||
        (viewport.height <= 480 && viewport.width > viewport.height);
      if (compactWelcome) {
        await expect(welcomeHeading).toBeHidden();
        await expect(
          page.getByText(
            'Begin with the photographs already in your camera roll, or place a memory manually on the map.',
          ),
        ).toBeHidden();
        const startRegion = page.getByRole('region', {
          name: 'Start your atlas',
        });
        await expect(startRegion).toBeVisible();
        const startRegionBox = await startRegion.boundingBox();
        expect(
          startRegionBox,
          `${viewport.name}: compact start dock`,
        ).not.toBeNull();
        expect(startRegionBox?.height ?? Infinity).toBeLessThanOrEqual(72);
      } else {
        await expect(welcomeHeading).toBeVisible();
      }
      const upload = page.getByRole('link', { name: 'Upload photos' });
      const manual = page.getByRole('button', {
        name: 'Place manually',
        exact: true,
      });
      await expectInsideViewport(page, upload, `${viewport.name}: upload`);
      await expectInsideViewport(page, manual, `${viewport.name}: manual`);
      await expectNoOverlap(upload, manual, `${viewport.name}: empty actions`);
      await auditState(
        page,
        testInfo,
        `fresh-empty-atlas-${viewport.name}`,
        monitor,
        { map: true },
      );

      if (compactWelcome) {
        await manual.click();
        await expect(
          page.getByRole('region', { name: 'Place a memory' }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expectInsideViewport(
          page,
          page.getByRole('button', { name: 'Cancel pin' }),
          `${viewport.name}: cancel placement`,
        );
        await auditState(
          page,
          testInfo,
          `fresh-empty-atlas-placement-${viewport.name}`,
          monitor,
          { map: true },
        );
        await page.getByRole('button', { name: 'Cancel pin' }).click();
      }
    });
  }

  const compactViewports = [
    { name: 'smallest-portrait', width: 320, height: 568 },
    { name: 'mobile-landscape', width: 568, height: 320 },
  ] as const;
  const today = new Date().toISOString().slice(0, 10);

  for (const viewport of compactViewports) {
    await page.setViewportSize(viewport);

    await test.step(`empty routes — ${viewport.name}`, async () => {
      await page.goto('/dashboard/places');
      await expectInsideViewport(
        page,
        page.getByRole('link', { name: 'Upload photos' }),
        `${viewport.name}: places upload`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-empty-places-${viewport.name}`,
        monitor,
        { mapTeardown: true },
      );

      await page.goto('/dashboard/chapters');
      await expectInsideViewport(
        page,
        page.getByRole('link', { name: 'Add memories' }),
        `${viewport.name}: journeys add memories`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-empty-journeys-${viewport.name}`,
        monitor,
      );

      await page.goto('/dashboard/chapters/new');
      await expectInsideViewport(
        page,
        page.getByRole('link', { name: 'Upload photos' }),
        `${viewport.name}: workshop upload`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-empty-workshop-${viewport.name}`,
        monitor,
      );

      await page.goto(`/dashboard/on-this-day?date=${today}`);
      await expectInsideViewport(
        page,
        page.getByRole('link', { name: 'Upload photos' }),
        `${viewport.name}: rediscovery upload`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-empty-rediscovery-${viewport.name}`,
        monitor,
      );

      await page.goto('/dashboard/import');
      await expectInsideViewport(
        page,
        page.getByText('Choose photos', { exact: true }),
        `${viewport.name}: choose photos`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-empty-import-${viewport.name}`,
        monitor,
      );

      await page.goto('/dashboard/security');
      await expectInsideViewport(
        page,
        page.getByRole('button', { name: 'Sign out everywhere' }),
        `${viewport.name}: session control`,
      );
      await auditState(
        page,
        testInfo,
        `fresh-security-${viewport.name}`,
        monitor,
      );

      const accountMenu = page.locator('.dashboard-mobile-account-menu');
      await accountMenu.locator('summary').click();
      const popover = accountMenu.locator('.dashboard-mobile-account-popover');
      await expectInsideViewport(
        page,
        popover,
        `${viewport.name}: account popover`,
      );
      const securityLink = popover.getByRole('link', {
        name: /account & security/i,
      });
      await securityLink.click();
      await expect(accountMenu).not.toHaveAttribute('open');
    });
  }

  monitor.stop();
});

test('an empty account can preserve memories, shape a journey, and cleanly remove both', async ({
  browser,
  page,
}, testInfo) => {
  requireLifecycleAuditEnvironment();
  test.skip(
    !canRunLifecycleAudit(),
    'The destructive lifecycle audit requires its dedicated loopback database and filesystem media root.',
  );
  test.setTimeout(360_000);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: baseUrl,
  });
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await signIn(page);
  const monitor = monitorBrowserIssues(page);
  await expect(
    page.getByRole('heading', { name: 'Your world is waiting.' }),
  ).toBeVisible();
  await auditState(page, testInfo, 'empty-atlas', monitor, { map: true });

  await page.goto('/dashboard/places');
  await expect(
    page.getByRole('heading', {
      name: 'Your collection is ready for its first place.',
    }),
  ).toBeVisible();
  await auditState(page, testInfo, 'empty-places', monitor, {
    mapTeardown: true,
  });

  await page.goto('/dashboard/chapters');
  await expect(
    page.getByRole('heading', {
      name: /(?:Bring a journey into focus|Start with two memories)\./,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Add memories/i }).first(),
  ).toBeVisible();
  await auditState(page, testInfo, 'empty-journeys', monitor);

  await page.goto('/dashboard/chapters/new');
  await expect(
    page.getByRole('heading', {
      name: 'Your journey needs memories first.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /(?:Open your atlas|Add memories)/i }),
  ).toBeVisible();
  await auditState(page, testInfo, 'empty-workshop', monitor);

  await page.goto('/dashboard');
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
  const selectedMemories =
    testInfo.project.name === 'chromium' ? memories : memories.slice(0, 2);
  for (let index = 0; index < selectedMemories.length; index += 1) {
    await createMemory(page, selectedMemories[index], index);
  }

  const persistedAfterCreate = await loadPersistedMemories();
  expect(persistedAfterCreate).toHaveLength(selectedMemories.length);
  expect(
    persistedAfterCreate
      .map((memory) => ({
        deleted: memory.deleted_at,
        media: memory.media_count,
        title: memory.title,
      }))
      .sort((first, second) => first.title.localeCompare(second.title)),
  ).toEqual(
    selectedMemories
      .map((memory) => ({
        deleted: null,
        media: memory.file ? 1 : 0,
        title: memory.title,
      }))
      .sort((first, second) => first.title.localeCompare(second.title)),
  );
  await expect
    .poll(async () => (await storedObjectNames()).length)
    .toBe(selectedMemories.filter((memory) => memory.file).length * 2);

  const firstEditor = await openMemory(page, selectedMemories[0].title);
  const privateImageSource = await firstEditor
    .locator('figure img')
    .getAttribute('src');
  expect(privateImageSource).not.toBeNull();
  await expectPrivateImage(page, browser, privateImageSource ?? '');

  if (testInfo.project.name === 'chromium') {
    await page.evaluate(() => {
      window.history.pushState(
        window.history.state,
        '',
        '/dashboard?guard=photo',
      );
    });
    let resumeUploads: () => void = () => undefined;
    let delayedUploads = 0;
    const uploadGate = new Promise<void>((resolve) => {
      resumeUploads = resolve;
    });
    const uploadPattern = '**/api/atlas/media/upload?**';
    await page.route(uploadPattern, async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      delayedUploads += 1;
      await uploadGate;
      await route.continue();
    });

    await firstEditor.locator('input[type="file"]').setInputFiles(kyotoFixture);
    await expect.poll(() => delayedUploads, { timeout: 30_000 }).toBe(2);
    await expect(firstEditor.getByText('Saving photo changes…')).toBeVisible();
    await expect(
      firstEditor.getByRole('link', { name: 'View keepsake' }),
    ).toHaveCount(0);

    const guardedPhotoUrl = page.url();
    const photoNavigationPrompt = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const originalConfirm = window.confirm;
          const timeout = window.setTimeout(() => {
            window.confirm = originalConfirm;
            resolve('');
          }, 3_000);
          window.confirm = (message) => {
            window.clearTimeout(timeout);
            window.confirm = originalConfirm;
            resolve(String(message));
            return false;
          };
          window.history.back();
        }),
    );
    expect(photoNavigationPrompt).toContain('photo changes are still saving');
    await expect(page).toHaveURL(guardedPhotoUrl);
    await expect(firstEditor).toBeVisible();

    resumeUploads();
    await expect(
      firstEditor.getByText(/1 photo was added and saved privately\./i),
    ).toBeVisible({ timeout: 60_000 });
    await page.unroute(uploadPattern);
    await expect(firstEditor.locator('figure img')).toHaveCount(2);
    await expect(
      firstEditor.getByRole('link', { name: 'View keepsake' }),
    ).toBeVisible();
    await firstEditor
      .getByRole('button', { name: 'Remove photo' })
      .last()
      .click();
    await firstEditor
      .getByRole('button', { name: 'Confirm remove photo' })
      .click();
    await expect(firstEditor.getByText('Photo removed and saved.')).toBeVisible(
      {
        timeout: 30_000,
      },
    );
    await expect(firstEditor.locator('figure img')).toHaveCount(1);
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, '', '/dashboard');
    });
  }

  await firstEditor
    .getByRole('textbox', { name: 'Field note' })
    .fill('This unsaved field note should never replace the saved one.');
  if (testInfo.project.name === 'chromium') {
    await page.evaluate(() => {
      window.history.pushState(
        window.history.state,
        '',
        '/dashboard?guard=fields',
      );
    });
    const guardedFieldUrl = page.url();
    const fieldNavigationPrompt = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const originalConfirm = window.confirm;
          const timeout = window.setTimeout(() => {
            window.confirm = originalConfirm;
            resolve('');
          }, 3_000);
          window.confirm = (message) => {
            window.clearTimeout(timeout);
            window.confirm = originalConfirm;
            resolve(String(message));
            return false;
          };
          window.history.back();
        }),
    );
    expect(fieldNavigationPrompt).toContain('unsaved field changes');
    await expect(page).toHaveURL(guardedFieldUrl);
    await expect(
      firstEditor.getByRole('textbox', { name: 'Field note' }),
    ).toHaveValue(
      'This unsaved field note should never replace the saved one.',
    );
    await page.evaluate(() => {
      window.history.replaceState(window.history.state, '', '/dashboard');
    });
  }
  await firstEditor
    .getByRole('button', { name: /Review unsaved (?:field )?changes/ })
    .click();
  await expect(firstEditor.getByRole('alert')).toContainText(
    /unsaved (?:field )?changes/,
  );
  await firstEditor.getByRole('button', { name: /Confirm discard/ }).click();
  await expect(firstEditor).toBeHidden();

  const reopenedFirst = await openMemory(page, selectedMemories[0].title);
  await expect(
    reopenedFirst.getByRole('textbox', { name: 'Field note' }),
  ).toHaveValue(selectedMemories[0].note);
  const revisedNote = `${selectedMemories[0].note} The air smelled like rain.`;
  await reopenedFirst
    .getByRole('textbox', { name: 'Field note' })
    .fill(revisedNote);
  await reopenedFirst
    .getByRole('button', { name: 'I want to go', exact: true })
    .click();
  await reopenedFirst.getByRole('button', { name: 'Save changes' }).click();
  await expect(reopenedFirst.getByText('Saved to your atlas')).toBeVisible({
    timeout: 30_000,
  });

  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 320, height: 568 });
    await auditState(
      page,
      testInfo,
      'memory-editor-smallest-portrait',
      monitor,
      {
        map: true,
      },
    );
    await page.setViewportSize({ width: 568, height: 320 });
    await auditState(page, testInfo, 'memory-editor-landscape', monitor, {
      map: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  } else {
    await auditState(page, testInfo, 'memory-editor', monitor, { map: true });
  }
  await reopenedFirst.getByRole('button', { name: 'Close memory' }).click();

  const revisedMemory = (await loadPersistedMemories()).find(
    (memory) => memory.title === selectedMemories[0].title,
  );
  expect(revisedMemory).toMatchObject({
    journey_state: 'want_to_visit',
    version: 3,
  });

  const { explicitCover, ordered } = await createJourney(
    page,
    selectedMemories,
  );
  await auditState(page, testInfo, 'journey-workshop-arrange', monitor, {
    mapTeardown: true,
  });
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 320, height: 568 });
    await auditState(page, testInfo, 'workshop-smallest-portrait', monitor);
    await page.setViewportSize({ width: 568, height: 320 });
    await auditState(page, testInfo, 'workshop-landscape', monitor);
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await page.getByRole('button', { name: 'Create journey' }).click();
  await expect(page).toHaveURL(
    /\/dashboard\/chapters\/[0-9a-f-]+\?saved=created/i,
    {
      timeout: 30_000,
    },
  );
  await expect(
    page.getByRole('heading', { level: 1, name: createdJourneyTitle }),
  ).toBeVisible();
  await expectReaderOrder(
    page,
    ordered.map((memory) => memory.title),
  );
  await expect(page.getByText(transitionNote)).toBeVisible();
  await auditState(page, testInfo, 'journey-reader-created', monitor, {
    readerMap: true,
  });

  const persistedJourney = await loadPersistedJourney(createdJourneyTitle);
  expect(persistedJourney).toMatchObject({
    cover_entry_title: explicitCover?.title ?? null,
    introduction: journeyIntroduction,
    share_location_precision: 'exact',
    share_map: true,
    title: createdJourneyTitle,
    version: 1,
    visibility: 'shared',
  });
  expect(persistedJourney?.stops).toEqual(
    ordered.map((memory, index) => ({
      position: index,
      title: memory.title,
      transition_note: index === 1 ? transitionNote : '',
    })),
  );

  await page.getByRole('button', { name: 'Share journey' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Unlisted journey link copied.' }),
  ).toBeVisible();
  const firstSharedUrl = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(firstSharedUrl).toBe(
    `${baseUrl}/shared/chapters/${persistedJourney?.share_id}`,
  );
  let activeSharedUrl = firstSharedUrl;

  const anonymousDevice =
    testInfo.project.name === 'mobile-chromium'
      ? devices['Pixel 7']
      : testInfo.project.name === 'mobile-chromium-landscape'
        ? devices['Pixel 7 landscape']
        : devices['Desktop Chrome'];
  const anonymous = await browser.newContext({
    ...anonymousDevice,
    colorScheme: 'light',
  });
  try {
    const sharedPage = await anonymous.newPage();
    const sharedMonitor = monitorBrowserIssues(sharedPage);
    const sharedResponse = await sharedPage.goto(firstSharedUrl);
    expect(sharedResponse?.status()).toBe(200);
    await expect(
      sharedPage.getByRole('heading', {
        level: 1,
        name: createdJourneyTitle,
      }),
    ).toBeVisible();
    await expectReaderOrder(
      sharedPage,
      ordered.map((memory) => memory.title),
    );
    await auditState(
      sharedPage,
      testInfo,
      'journey-shared-reader',
      sharedMonitor,
      { readerMap: true },
    );
    sharedMonitor.stop();

    if (testInfo.project.name === 'chromium') {
      await page.getByRole('link', { name: 'Edit journey' }).click();
      await expect(
        page.getByRole('heading', { name: 'Shape your journey.' }),
      ).toBeVisible();
      const stalePage = await page.context().newPage();
      try {
        await stalePage.goto(page.url());
        await expect(
          stalePage.getByRole('heading', { name: 'Shape your journey.' }),
        ).toBeVisible();

        await page.getByLabel('Journey title').fill(updatedJourneyTitle);
        const editUrl = page.url();

        const linkDialogPromise = page.waitForEvent('dialog', {
          timeout: 10_000,
        });
        const linkClickPromise = page
          .getByRole('link', { name: 'Back to journey' })
          .click();
        const linkDialog = await linkDialogPromise;
        expect(linkDialog.message()).toContain('unsaved changes');
        await linkDialog.dismiss();
        await linkClickPromise;
        await expect(page).toHaveURL(editUrl);

        const historyPrompt = await page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const originalConfirm = window.confirm;
              const timeout = window.setTimeout(() => {
                window.confirm = originalConfirm;
                resolve('');
              }, 3_000);
              window.confirm = (message) => {
                window.clearTimeout(timeout);
                window.confirm = originalConfirm;
                resolve(String(message));
                return false;
              };
              window.history.back();
            }),
        );
        expect(historyPrompt).toContain('unsaved changes');
        await expect(page).toHaveURL(editUrl);

        const acceptedBackDialogPromise = page.waitForEvent('dialog', {
          timeout: 10_000,
        });
        const acceptedBackPromise = page.goBack();
        const acceptedBackDialog = await acceptedBackDialogPromise;
        expect(acceptedBackDialog.message()).toContain('unsaved changes');
        await acceptedBackDialog.accept();
        await acceptedBackPromise;
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: createdJourneyTitle,
          }),
        ).toBeVisible();

        await page.goForward();
        await expect(
          page.getByRole('heading', { name: 'Shape your journey.' }),
        ).toBeVisible();
        await expect(page.getByLabel('Journey title')).toHaveValue(
          createdJourneyTitle,
        );
        expect(await page.goForward()).toBeNull();

        await page.getByRole('link', { name: 'Back to journey' }).click();
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: createdJourneyTitle,
          }),
        ).toBeVisible();
        await page.goBack();
        await expect(
          page.getByRole('heading', { name: 'Shape your journey.' }),
        ).toBeVisible();
        await page
          .getByLabel('Journey title')
          .fill('A forward-guarded journey draft');
        const forwardPrompt = await page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const originalConfirm = window.confirm;
              const timeout = window.setTimeout(() => {
                window.confirm = originalConfirm;
                resolve('');
              }, 3_000);
              window.confirm = (message) => {
                window.clearTimeout(timeout);
                window.confirm = originalConfirm;
                resolve(String(message));
                return false;
              };
              window.history.forward();
            }),
        );
        expect(forwardPrompt).toContain('unsaved changes');
        await expect(page).toHaveURL(editUrl);
        await expect(page.getByLabel('Journey title')).toHaveValue(
          'A forward-guarded journey draft',
        );

        const acceptedForwardDialogPromise = page.waitForEvent('dialog', {
          timeout: 10_000,
        });
        const acceptedForwardPromise = page.goForward();
        const acceptedForwardDialog = await acceptedForwardDialogPromise;
        expect(acceptedForwardDialog.message()).toContain('unsaved changes');
        await acceptedForwardDialog.accept();
        await acceptedForwardPromise;
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: createdJourneyTitle,
          }),
        ).toBeVisible();

        await page.getByRole('link', { name: 'Edit journey' }).click();
        await expect(
          page.getByRole('heading', { name: 'Shape your journey.' }),
        ).toBeVisible();
        await page.getByLabel('Journey title').fill(updatedJourneyTitle);
        await page.getByRole('button', { name: /Arrange & share/i }).click();
        await page.getByLabel(/^Private/).check();
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page).toHaveURL(/\?saved=updated$/i, {
          timeout: 30_000,
        });
        await expect(
          page.getByRole('heading', { level: 1, name: updatedJourneyTitle }),
        ).toBeVisible();

        await stalePage
          .getByLabel('Journey title')
          .fill('A stale competing title');
        await stalePage
          .getByRole('button', { name: /Arrange & share/i })
          .click();
        await stalePage.getByRole('button', { name: 'Save changes' }).click();
        const conflict = stalePage
          .getByRole('alert')
          .filter({ hasText: 'newer version' });
        await expect(conflict).toContainText('newer version', {
          timeout: 30_000,
        });
        await expect(stalePage.getByLabel('Journey title')).toHaveValue(
          'A stale competing title',
        );
        await expect(
          conflict.getByRole('link', { name: 'Review latest in a new tab' }),
        ).toBeVisible();

        await stalePage
          .getByRole('button', { name: 'Delete journey', exact: true })
          .click();
        const staleDeleteDialog = stalePage.getByRole('alertdialog', {
          name: /Delete this journey/i,
        });
        await staleDeleteDialog
          .getByRole('button', { name: /Delete journey permanently/i })
          .click();
        await expect(
          stalePage
            .getByRole('alert')
            .filter({ hasText: 'Refresh it before deleting' }),
        ).toBeVisible({ timeout: 30_000 });
        expect(await loadPersistedJourney(updatedJourneyTitle)).toMatchObject({
          title: updatedJourneyTitle,
          visibility: 'private',
          version: 2,
        });
      } finally {
        await stalePage.close().catch(() => undefined);
      }

      await expectSharedJourneyUnavailable(anonymous.request, firstSharedUrl, [
        createdJourneyTitle,
        updatedJourneyTitle,
      ]);

      await page.getByRole('link', { name: 'Edit journey' }).click();
      await page.getByRole('button', { name: /Arrange & share/i }).click();
      await page.getByLabel(/Anyone with the link/).check();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page).toHaveURL(/\?saved=updated$/i, { timeout: 30_000 });
      const resharedJourney = await loadPersistedJourney(updatedJourneyTitle);
      expect(resharedJourney).toMatchObject({
        title: updatedJourneyTitle,
        version: 3,
        visibility: 'shared',
      });
      if (!resharedJourney)
        throw new Error('The reshared journey was not saved.');
      expect(resharedJourney.share_id).not.toBe(persistedJourney?.share_id);
      const resharedUrl = `${baseUrl}/shared/chapters/${resharedJourney.share_id}`;
      activeSharedUrl = resharedUrl;
      expect((await sharedPage.goto(resharedUrl))?.status()).toBe(200);
      await expect(
        sharedPage.getByRole('heading', {
          level: 1,
          name: updatedJourneyTitle,
        }),
      ).toBeVisible();
    }
  } finally {
    await anonymous.close();
  }

  await page.getByRole('link', { name: 'Edit journey' }).click();
  await page.getByRole('button', { name: /Arrange & share/i }).click();
  const deleteTrigger = page.getByRole('button', {
    name: 'Delete journey',
    exact: true,
  });
  await deleteTrigger.click();
  const deleteDialog = page.getByRole('alertdialog', {
    name: /Delete this journey/i,
  });
  const keepJourney = deleteDialog.getByRole('button', {
    name: 'Keep journey',
  });
  await expect(deleteDialog).toContainText(
    'Its memories will stay in your atlas.',
  );
  await expect(keepJourney).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(deleteDialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await expect(keepJourney).toBeFocused();
  await keepJourney.click();
  await expect(deleteDialog).toBeHidden();
  await expect(deleteTrigger).toBeFocused();

  await deleteTrigger.click();
  await auditState(page, testInfo, 'journey-delete-confirmation', monitor);
  await deleteDialog
    .getByRole('button', { name: /Delete journey permanently/i })
    .click();
  await expect(page).toHaveURL('/dashboard/chapters', { timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: 'Bring a journey into focus.' }),
  ).toBeVisible();
  expect(await loadPersistedJourney()).toBeNull();
  const deletedShareContext = await browser.newContext();
  try {
    await expectSharedJourneyUnavailable(
      deletedShareContext.request,
      activeSharedUrl,
      [createdJourneyTitle, updatedJourneyTitle],
    );
  } finally {
    await deletedShareContext.close();
  }
  expect(
    (await loadPersistedMemories()).filter((memory) => !memory.deleted_at),
  ).toHaveLength(selectedMemories.length);

  await page.goto('/dashboard');
  await expect(page.locator('[data-map-state="ready"]')).toBeVisible({
    timeout: 20_000,
  });
  for (let index = 0; index < selectedMemories.length; index += 1) {
    await removeMemory(page, selectedMemories[index].title, index === 0);
  }
  await expect(
    page.getByRole('heading', { name: 'Your world is waiting.' }),
  ).toBeVisible();
  await expect.poll(async () => (await storedObjectNames()).length).toBe(0);
  const finalMemories = await loadPersistedMemories();
  expect(finalMemories).toHaveLength(selectedMemories.length);
  expect(finalMemories.every((memory) => memory.deleted_at)).toBe(true);
  expect(finalMemories.every((memory) => memory.media_count === 0)).toBe(true);
  await auditState(page, testInfo, 'returned-to-empty-atlas', monitor, {
    map: true,
  });
  monitor.stop();
});
