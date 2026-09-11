import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { Client } from 'pg';

import {
  E2E_FIXTURE,
  getE2EMediaStorageConfiguration,
  resetE2EMediaStorage,
} from '../scripts/seed-e2e.js';
import { auditCurrentPage, monitorBrowserIssues } from './support/ui-audit';

const fixtureRoot = path.join(
  process.cwd(),
  'output/uiux-image-upload/test-images',
);
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

const riverwalkFixture = path.join(fixtureRoot, 'riverwalk-test.png');
const kyotoFixture = path.join(fixtureRoot, 'kyoto-test.png');
const trailheadFixture = path.join(fixtureRoot, 'trailhead-test.png');

const chapterTitle = 'Two cities, one field atlas';
const chapterIntroduction =
  'A browser-tested route from the Detroit River to a rain-lit Kyoto lane.';
const riverwalkMemory = {
  fileName: 'riverwalk-test.png',
  note: 'Morning light moved across the river before the city woke.',
  place: 'Detroit RiverWalk, Detroit, Michigan',
  title: 'River light before breakfast',
  visitedOn: '2024-05-18',
};
const kyotoMemory = {
  fileName: 'kyoto-test.png',
  note: 'The stones held the rain and every lantern doubled in the street.',
  place: 'Gion, Kyoto, Japan',
  title: 'Lanterns after the rain',
  visitedOn: '2025-03-09',
};
const cancelledMemory = {
  fileName: 'trailhead-test.png',
  note: 'A temporary private draft created to prove cleanup is recoverable.',
  place: 'Black Cloud Trail, Colorado',
  title: 'E2E cleanup trailhead',
  visitedOn: '2026-07-04',
};

type MemoryDetails = {
  fileName: string;
  note: string;
  place: string;
  title: string;
  visitedOn: string;
};

type UploadPhase = 'chapter' | 'cancel';

type UploadAttempt = {
  pathname: string;
  phase: UploadPhase;
};

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function usesLoopbackE2EOrigin() {
  try {
    const origin = new URL(baseUrl);
    return (
      origin.protocol === 'http:' &&
      loopbackHosts.has(origin.hostname.toLowerCase()) &&
      !origin.username &&
      !origin.password &&
      origin.pathname === '/' &&
      !origin.search &&
      !origin.hash
    );
  } catch {
    return false;
  }
}

function canRunDestructiveCanary() {
  return (
    !process.env.E2E_BASE_URL &&
    process.env.E2E_MEDIA_STORAGE_ADAPTER === 'filesystem' &&
    process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER === 'filesystem' &&
    process.env.E2E_TEST_EMAIL === E2E_FIXTURE.email &&
    usesLoopbackE2EOrigin()
  );
}

function assertRequiredCanaryEnvironment() {
  if (process.env.E2E_REQUIRE_FULL_IMPORT !== '1') return;
  if (!canRunDestructiveCanary()) {
    throw new Error(
      "The required full-import canary must use Playwright's own loopback server and both filesystem adapter flags.",
    );
  }
}

function getE2EDatabaseConnectionString() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Full photo import requires DATABASE_URL.');
  }

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
    throw new Error(
      'Full photo import is restricted to the loopback field_atlas_e2e database.',
    );
  }
  return connectionString;
}

async function withE2EDatabase<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString: getE2EDatabaseConnectionString(),
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function storedObjectNames() {
  const configuration = getE2EMediaStorageConfiguration(process.env);
  const entries = await readdir(configuration.storageRoot, {
    withFileTypes: true,
  });
  expect(entries.every((entry) => entry.isFile())).toBe(true);
  return entries.map((entry) => entry.name).sort();
}

async function cleanupFullImportFixtures() {
  const configuration = getE2EMediaStorageConfiguration(process.env);
  await withE2EDatabase(async (client) => {
    await client.query('BEGIN');
    try {
      const users = await client.query<{
        email: string;
        id: string;
        role: string;
      }>(
        'SELECT id::text, email, role::text FROM users ORDER BY id FOR UPDATE',
      );
      if (
        users.rows.length !== 1 ||
        users.rows[0]?.id !== E2E_FIXTURE.userId ||
        users.rows[0]?.email.toLowerCase() !== E2E_FIXTURE.email ||
        users.rows[0]?.role === 'owner'
      ) {
        throw new Error(
          'Refusing to clean a database without the sole deterministic non-owner E2E account.',
        );
      }
      const userId = E2E_FIXTURE.userId;
      await client.query(
        'DELETE FROM atlas_media_upload_intents WHERE user_id = $1',
        [userId],
      );
      await client.query(
        'DELETE FROM atlas_chapters WHERE user_id = $1 AND id <> $2',
        [userId, E2E_FIXTURE.chapterId],
      );
      await client.query(
        'DELETE FROM atlas_import_batches WHERE user_id = $1',
        [userId],
      );
      await client.query(
        'DELETE FROM atlas_entries WHERE user_id = $1 AND id <> $2',
        [userId, E2E_FIXTURE.entryId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  await resetE2EMediaStorage(configuration);
}

async function loadPersistedChapter() {
  return withE2EDatabase(async (client) => {
    const chapter = await client.query<{
      id: string;
      introduction: string;
      title: string;
    }>(
      `
        SELECT chapter.id, chapter.title, chapter.introduction
        FROM atlas_chapters AS chapter
        INNER JOIN users AS owner ON owner.id = chapter.user_id
        INNER JOIN atlas_import_batches AS batch
          ON batch.id = chapter.import_batch_id
          AND batch.user_id = chapter.user_id
        WHERE owner.email = $1
          AND chapter.title = $2
          AND batch.status = 'completed'
        LIMIT 1
      `,
      [process.env.E2E_TEST_EMAIL, chapterTitle],
    );
    const row = chapter.rows[0];
    expect(row).toBeDefined();

    const memories = await client.query<{
      date_confirmed: boolean;
      date_source: string;
      description: string;
      id: string;
      latitude: number;
      location_source: string;
      longitude: number;
      media_count: number;
      place_label: string;
      place_source: string;
      position: number;
      title: string;
      visited_on: string;
    }>(
      `
        SELECT
          entry.id,
          chapter_entry.position,
          entry.title,
          entry.description,
          entry.place_label,
          entry.visited_on::text,
          ST_Y(entry.location::geometry)::float8 AS latitude,
          ST_X(entry.location::geometry)::float8 AS longitude,
          item.location_source,
          item.date_source,
          item.date_confirmed,
          item.place_source,
          (
            SELECT COUNT(*)::integer
            FROM atlas_media AS media
            WHERE media.entry_id = entry.id
              AND media.user_id = entry.user_id
          ) AS media_count
        FROM atlas_chapter_entries AS chapter_entry
        INNER JOIN atlas_entries AS entry
          ON entry.id = chapter_entry.entry_id
          AND entry.user_id = chapter_entry.user_id
        INNER JOIN atlas_import_items AS item
          ON item.entry_id = entry.id
          AND item.user_id = entry.user_id
        WHERE chapter_entry.chapter_id = $1
          AND entry.record_state = 'saved'
          AND entry.deleted_at IS NULL
        ORDER BY chapter_entry.position
      `,
      [row?.id],
    );
    expect(memories.rows).toEqual([
      expect.objectContaining({
        date_confirmed: true,
        date_source: 'manual',
        description: riverwalkMemory.note,
        location_source: 'manual',
        media_count: 1,
        place_label: riverwalkMemory.place,
        position: 0,
        title: riverwalkMemory.title,
        visited_on: riverwalkMemory.visitedOn,
      }),
      expect.objectContaining({
        date_confirmed: true,
        date_source: 'manual',
        description: kyotoMemory.note,
        location_source: 'manual',
        media_count: 1,
        place_label: kyotoMemory.place,
        position: 1,
        title: kyotoMemory.title,
        visited_on: kyotoMemory.visitedOn,
      }),
    ]);
    for (const memory of memories.rows) {
      expect(memory.latitude).toBeGreaterThanOrEqual(-90);
      expect(memory.latitude).toBeLessThanOrEqual(90);
      expect(memory.longitude).toBeGreaterThanOrEqual(-180);
      expect(memory.longitude).toBeLessThanOrEqual(180);
      expect(memory.place_source).toMatch(/^(geocoder|manual)$/);
    }
    return { ...row!, entryIds: memories.rows.map((memory) => memory.id) };
  });
}

async function loadCancelledImportForCleanup() {
  return withE2EDatabase(async (client) => {
    const cancelled = await client.query<{
      batch_id: string;
      cleanup_not_before: Date;
      cleanup_started_at: Date | null;
      entry_id: string;
    }>(
      `
        SELECT
          batch.id AS batch_id,
          batch.cleanup_not_before,
          batch.cleanup_started_at,
          item.entry_id
        FROM atlas_import_batches AS batch
        INNER JOIN atlas_import_items AS item
          ON item.batch_id = batch.id AND item.user_id = batch.user_id
        INNER JOIN atlas_entries AS entry
          ON entry.id = item.entry_id AND entry.user_id = item.user_id
        INNER JOIN users AS owner ON owner.id = batch.user_id
        WHERE owner.email = $1
          AND batch.status = 'cancel_pending'
          AND entry.title = $2
      `,
      [process.env.E2E_TEST_EMAIL, cancelledMemory.title],
    );
    expect(cancelled.rows).toHaveLength(1);
    return cancelled.rows[0]!;
  });
}

async function releaseCancelledImportForCleanup(batchId: string) {
  await withE2EDatabase(async (client) => {
    const released = await client.query<{
      cleanup_not_before: Date;
      cleanup_started_at: Date | null;
      due: boolean;
    }>(
      `
        UPDATE atlas_import_batches
        SET cleanup_not_before = NOW() - INTERVAL '1 second',
            cleanup_started_at = NULL
        WHERE id = $1 AND status = 'cancel_pending'
        RETURNING
          cleanup_not_before,
          cleanup_started_at,
          cleanup_not_before <= NOW() AS due
      `,
      [batchId],
    );
    expect(released.rows).toHaveLength(1);
    expect(released.rows[0]).toMatchObject({
      cleanup_started_at: null,
      due: true,
    });
  });
}

async function expectCancelledImportRemoved(batchId: string, entryId: string) {
  await withE2EDatabase(async (client) => {
    const remaining = await client.query<{
      batches: number;
      entries: number;
      intents: number;
      items: number;
      media: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::integer FROM atlas_import_batches WHERE id = $1) AS batches,
          (SELECT COUNT(*)::integer FROM atlas_import_items WHERE batch_id = $1) AS items,
          (SELECT COUNT(*)::integer FROM atlas_entries WHERE id = $2) AS entries,
          (SELECT COUNT(*)::integer FROM atlas_media WHERE entry_id = $2) AS media,
          (SELECT COUNT(*)::integer FROM atlas_media_upload_intents WHERE entry_id = $2) AS intents
      `,
      [batchId, entryId],
    );
    expect(remaining.rows[0]).toEqual({
      batches: 0,
      entries: 0,
      intents: 0,
      items: 0,
      media: 0,
    });
  });
}

async function expectCancelledImportPresent(batchId: string, entryId: string) {
  await withE2EDatabase(async (client) => {
    const remaining = await client.query<{
      batches: number;
      completed_pairs: number;
      entries: number;
      intents: number;
      items: number;
      media: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::integer FROM atlas_import_batches WHERE id = $1) AS batches,
          (SELECT COUNT(*)::integer FROM atlas_import_items WHERE batch_id = $1) AS items,
          (SELECT COUNT(*)::integer FROM atlas_entries WHERE id = $2) AS entries,
          (SELECT COUNT(*)::integer FROM atlas_media WHERE entry_id = $2) AS media,
          (SELECT COUNT(*)::integer FROM atlas_media_upload_intents WHERE entry_id = $2) AS intents,
          (
            SELECT COUNT(*)::integer
            FROM atlas_media_upload_intents
            WHERE entry_id = $2
              AND original_uploaded_at IS NOT NULL
              AND thumbnail_uploaded_at IS NOT NULL
          ) AS completed_pairs
      `,
      [batchId, entryId],
    );
    expect(remaining.rows[0]).toEqual({
      batches: 1,
      completed_pairs: 1,
      entries: 1,
      intents: 1,
      items: 1,
      media: 0,
    });
  });
}

async function runImportCleanup(page: Page, expectedCleanedImports: number) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('Full photo import cleanup requires CRON_SECRET.');
  }
  const response = await page.request.get('/api/internal/auth-cleanup', {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    ok: true,
    atlasCleanup: { imports: { cleaned: expectedCleanedImports } },
  });
}

function expectInjectedUploadFailure(
  monitor: ReturnType<typeof monitorBrowserIssues>,
  expectedUrl: string,
) {
  const issues = monitor.flush();
  const expectedResponse = issues.filter(
    (issue) =>
      issue.kind === 'http-response' &&
      issue.status === 503 &&
      issue.url === expectedUrl,
  );
  const expectedConsole = issues.filter(
    (issue) =>
      issue.kind === 'console' &&
      issue.level === 'error' &&
      issue.url === expectedUrl &&
      /\b503\b/.test(issue.message),
  );
  const unexpected = issues.filter(
    (issue) =>
      !expectedResponse.includes(issue) && !expectedConsole.includes(issue),
  );

  expect(expectedResponse).toHaveLength(1);
  expect(expectedConsole).toHaveLength(1);
  expect(unexpected).toEqual([]);
}

async function signIn(page: Page) {
  const email = process.env.E2E_TEST_EMAIL?.trim();
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Full photo import requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD.',
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

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  });
}

async function chooseAndReviewPhotos(
  page: Page,
  files: string[],
  memories: MemoryDetails[],
) {
  await page.goto('/dashboard/import', { waitUntil: 'networkidle' });
  await page.getByLabel('Choose photos', { exact: true }).setInputFiles(files);

  const count = files.length;
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: `${count} ${count === 1 ? 'photo' : 'photos'} selected`,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(
      `${count} ${count === 1 ? 'photo is' : 'photos are'} ready to review.`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 45_000 });

  await page
    .getByRole('button', {
      name: `Review ${count} ${count === 1 ? 'photo' : 'photos'}`,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'See where the journey took shape.',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: `${count} ${count === 1 ? 'memory' : 'memories'} across the map.`,
    }),
  ).toBeVisible();

  const confirmDates = page.getByRole('button', {
    name: `Confirm ${count} file ${count === 1 ? 'date' : 'dates'}`,
  });
  await expect(confirmDates).toBeVisible();
  await confirmDates.click();

  for (const memory of memories) {
    const reviewCard = page.locator('li').filter({
      has: page.getByRole('button', {
        name: `Remove ${memory.fileName}`,
      }),
    });
    await expect(reviewCard).toHaveCount(1);
    await reviewCard.getByRole('button', { name: 'Choose place' }).click();

    const locationDialog = page.getByRole('dialog', {
      name: 'Choose where this belongs.',
    });
    await expect(locationDialog).toBeVisible();
    await expect(
      locationDialog.locator('[data-map-state="ready"]'),
    ).toBeVisible({ timeout: 20_000 });
    await locationDialog
      .getByRole('button', { name: 'Use map center' })
      .click();
    await expect(locationDialog).toBeHidden({ timeout: 45_000 });
  }

  const detailsButton = page.getByRole('button', {
    name: 'Add optional details',
  });
  await expect(detailsButton).toBeEnabled({ timeout: 20_000 });
  return detailsButton;
}

async function fillMemoryDetails(page: Page, memory: MemoryDetails) {
  await page.getByRole('textbox', { name: /^Title/ }).fill(memory.title);
  await page.getByRole('textbox', { name: 'Place' }).fill(memory.place);
  await page.getByLabel('Date visited').fill(memory.visitedOn);
  await page.getByRole('textbox', { name: /^Field note/ }).fill(memory.note);
}

async function reachChapterStep(page: Page, memories: MemoryDetails[]) {
  await page.getByRole('button', { name: 'Add optional details' }).click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Give every place its voice.',
    }),
  ).toBeVisible();

  for (let index = 0; index < memories.length; index += 1) {
    const memory = memories[index];
    await expect(
      page.getByText(`Memory ${index + 1} of ${memories.length}`, {
        exact: true,
      }),
    ).toBeVisible();
    await fillMemoryDetails(page, memory);
    await page
      .getByRole('button', {
        name: index < memories.length - 1 ? 'Next memory' : 'Shape the chapter',
      })
      .click();
  }

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Bring the journey together.',
    }),
  ).toBeVisible();
}

async function reachSingleMemoryCreation(
  page: Page,
  fixture: string,
  memory: MemoryDetails,
) {
  const detailsButton = await chooseAndReviewPhotos(page, [fixture], [memory]);
  await detailsButton.click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Give every place its voice.',
    }),
  ).toBeVisible();
  await fillMemoryDetails(page, memory);
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
  expect(url).not.toMatch(/blob\.vercel-storage\.com/i);

  const ownerResponse = await page.context().request.get(url);
  expect(ownerResponse.status()).toBe(200);
  expect(ownerResponse.headers()['content-type']).toBe('image/jpeg');
  expect(ownerResponse.headers()['cache-control']).toContain('private');
  expect(ownerResponse.headers()['x-content-type-options']).toBe('nosniff');
  expect((await ownerResponse.body()).byteLength).toBeGreaterThan(0);
  const etag = ownerResponse.headers().etag;
  if (!etag) throw new Error('Private media response did not include an ETag.');
  const notModified = await page.context().request.get(url, {
    headers: { 'If-None-Match': etag },
  });
  expect(notModified.status()).toBe(304);

  const anonymous = await browser.newContext();
  try {
    const anonymousResponse = await anonymous.request.get(url);
    expect(anonymousResponse.status()).toBe(404);
  } finally {
    await anonymous.close();
  }
}

test.beforeEach(async ({}, testInfo) => {
  if (testInfo.project.name === 'chromium' && canRunDestructiveCanary()) {
    await cleanupFullImportFixtures();
  }
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'chromium' && canRunDestructiveCanary()) {
    await page.unrouteAll({ behavior: 'wait' }).catch(() => undefined);
    await cleanupFullImportFixtures();
  }
});

test('imports a private photo chapter, recovers a lost response, and cancels a separate draft', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The destructive full-import canary runs once against its isolated account.',
  );
  assertRequiredCanaryEnvironment();
  test.skip(
    !canRunDestructiveCanary(),
    "The destructive full-import canary only runs with Playwright's own loopback server and isolated filesystem media adapter.",
  );
  getE2EDatabaseConnectionString();
  getE2EMediaStorageConfiguration(process.env);
  test.setTimeout(300_000);

  await signIn(page);
  const monitor = monitorBrowserIssues(page);
  let uploadPhase: UploadPhase = 'chapter';
  const uploadAttempts: UploadAttempt[] = [];
  const injectedFaults = new Set<UploadPhase>();
  const injectedFaultUrls = new Map<UploadPhase, string>();

  await page.route('**/api/atlas/media/upload?pathname=*', async (route) => {
    const request = route.request();
    if (request.method() !== 'PUT') {
      await route.continue();
      return;
    }

    const pathname = new URL(request.url()).searchParams.get('pathname');
    if (!pathname) {
      await route.abort('failed');
      return;
    }
    uploadAttempts.push({ pathname, phase: uploadPhase });
    const originalPhoto =
      pathname.endsWith('.jpg') && !pathname.endsWith('.thumbnail.jpg');
    if (originalPhoto && !injectedFaults.has(uploadPhase)) {
      injectedFaults.add(uploadPhase);
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      injectedFaultUrls.set(uploadPhase, request.url());
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          error: 'E2E lost-response simulation after a committed upload.',
        }),
      });
      return;
    }
    await route.continue();
  });

  await chooseAndReviewPhotos(
    page,
    [riverwalkFixture, kyotoFixture],
    [riverwalkMemory, kyotoMemory],
  );
  await auditCurrentPage(page, testInfo, 'full-import-review-ready', monitor, {
    accessibility: true,
    readySelector: '[data-map-state="ready"]',
  });
  await reachChapterStep(page, [riverwalkMemory, kyotoMemory]);
  await page
    .getByRole('button', {
      name: `Use ${kyotoMemory.title} as chapter cover`,
    })
    .click();
  await page.getByRole('textbox', { name: 'Chapter title' }).fill(chapterTitle);
  await page
    .getByRole('textbox', { name: /^Introduction/ })
    .fill(chapterIntroduction);
  await auditCurrentPage(page, testInfo, 'full-import-chapter-ready', monitor, {
    accessibility: true,
  });

  const createChapter = page.getByRole('button', {
    name: 'Create 2 memories and 1 chapter',
  });
  await createChapter.click();
  const uploadAlert = page.getByRole('alert');
  await expect(uploadAlert).toBeVisible({ timeout: 90_000 });
  await expect(createChapter).toBeEnabled();
  expect(injectedFaults.has('chapter')).toBe(true);
  await attachScreenshot(page, testInfo, 'full-import-retry-ready');
  expectInjectedUploadFailure(monitor, injectedFaultUrls.get('chapter') ?? '');
  await createChapter.click();
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: '2 memories have found their place.',
    }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    page.getByRole('heading', { name: 'Your chapter is ready.' }),
  ).toBeVisible();
  const persistedChapter = await loadPersistedChapter();
  expect(persistedChapter).toMatchObject({
    introduction: chapterIntroduction,
    title: chapterTitle,
  });

  const chapterAttempts = uploadAttempts.filter(
    (attempt) => attempt.phase === 'chapter',
  );
  expect(chapterAttempts).toHaveLength(4);
  expect(new Set(chapterAttempts.map((attempt) => attempt.pathname)).size).toBe(
    4,
  );
  await expect.poll(async () => (await storedObjectNames()).length).toBe(4);
  await auditCurrentPage(page, testInfo, 'full-import-complete', monitor, {
    accessibility: true,
    readySelector: '[data-map-state="ready"]',
  });

  const openChapter = page.getByRole('link', { name: 'Open chapter' });
  const chapterHref = await openChapter.getAttribute('href');
  expect(chapterHref).toBe(`/dashboard/chapters/${persistedChapter.id}`);
  await openChapter.click();
  await expect(page).toHaveURL(/\/dashboard\/chapters\/[0-9a-f-]{36}$/i);
  await expect(
    page.getByRole('heading', { level: 1, name: chapterTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Chapter introduction' }),
  ).toContainText(chapterIntroduction);
  await expect(page.getByRole('link', { name: 'Share' })).toHaveAttribute(
    'href',
    /\/edit\?step=arrange#chapter-sharing-heading$/,
  );

  const chapterMemories = page.getByRole('list', {
    name: 'Chapter memories in journey order',
  });
  await expect(
    chapterMemories.getByRole('heading', {
      level: 3,
      name: riverwalkMemory.title,
    }),
  ).toBeVisible();
  await expect(
    chapterMemories.getByRole('heading', {
      level: 3,
      name: kyotoMemory.title,
    }),
  ).toBeVisible();
  await auditCurrentPage(page, testInfo, 'full-import-open-chapter', monitor, {
    accessibility: true,
    readyButton: 'Show route map',
    readySelector: 'button[aria-label^="Stop 1:"]',
  });

  const chapterImages = page.locator('img[src^="/api/atlas/media/"]');
  await expect(chapterImages).toHaveCount(3);
  const thumbnailSource = await chapterImages.first().getAttribute('src');
  expect(thumbnailSource).toContain('variant=thumbnail');
  await expectPrivateImage(page, browser, thumbnailSource!);

  await chapterMemories
    .getByRole('link', {
      name: `Open ${riverwalkMemory.title} keepsake — ${riverwalkMemory.place}`,
    })
    .click();
  await expect(page).toHaveURL(/\/dashboard\/card\/[0-9a-f-]{36}$/i);
  await expect(
    page.getByRole('heading', { level: 2, name: riverwalkMemory.title }),
  ).toBeVisible();
  await expect(
    page.getByText(riverwalkMemory.note, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(riverwalkMemory.place, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('May 18, 2024', { exact: true })).toBeVisible();
  await auditCurrentPage(page, testInfo, 'full-import-open-keepsake', monitor, {
    accessibility: true,
  });

  const originalImage = page.getByRole('img', {
    name: riverwalkMemory.title,
  });
  await expect(originalImage).toBeVisible();
  const originalSource = await originalImage.getAttribute('src');
  expect(originalSource).not.toContain('variant=thumbnail');
  await expectPrivateImage(page, browser, originalSource!);

  await page.goto(`/dashboard/card/${persistedChapter.entryIds[1]}`);
  await expect(
    page.getByRole('heading', { level: 2, name: kyotoMemory.title }),
  ).toBeVisible();
  await expect(page.getByText(kyotoMemory.note, { exact: true })).toBeVisible();
  await expect(
    page.getByText(kyotoMemory.place, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Mar 9, 2025', { exact: true })).toBeVisible();
  await auditCurrentPage(
    page,
    testInfo,
    'full-import-open-second-keepsake',
    monitor,
    {
      accessibility: true,
    },
  );

  await page.goto('/dashboard/places');
  const savedPlaces = page.getByRole('region', { name: 'Saved places' });
  await expect(
    savedPlaces.getByRole('link', {
      name: `Open ${riverwalkMemory.title} keepsake — ${riverwalkMemory.place}`,
    }),
  ).toBeVisible();
  await expect(
    savedPlaces.getByRole('link', {
      name: `Open ${kyotoMemory.title} keepsake — ${kyotoMemory.place}`,
    }),
  ).toBeVisible();
  await auditCurrentPage(page, testInfo, 'full-import-collection', monitor, {
    accessibility: true,
  });

  uploadPhase = 'cancel';
  await reachSingleMemoryCreation(page, trailheadFixture, cancelledMemory);
  await auditCurrentPage(
    page,
    testInfo,
    'full-import-cancel-draft-ready',
    monitor,
    { accessibility: true },
  );
  const createCancelledMemory = page.getByRole('button', {
    name: 'Create memory',
  });
  await createCancelledMemory.click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 90_000 });
  await expect(createCancelledMemory).toBeEnabled();
  expect(injectedFaults.has('cancel')).toBe(true);
  expectInjectedUploadFailure(monitor, injectedFaultUrls.get('cancel') ?? '');

  await page.getByRole('button', { name: 'Leave upload' }).click();
  const leaveDialog = page.getByRole('alertdialog', {
    name: 'Your unfinished review will close.',
  });
  await expect(leaveDialog).toContainText(
    'Field Atlas will also clear the private import draft and any prepared uploads.',
  );
  await attachScreenshot(page, testInfo, 'full-import-cancel-confirmation');
  await leaveDialog.getByRole('button', { name: 'Discard upload' }).click();
  await leaveDialog.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/i, { timeout: 30_000 });

  const cancelledAttempts = uploadAttempts.filter(
    (attempt) => attempt.phase === 'cancel',
  );
  expect(cancelledAttempts).toHaveLength(2);
  expect(
    cancelledAttempts.some((attempt) =>
      attempt.pathname.endsWith('.thumbnail.jpg'),
    ),
  ).toBe(true);
  await testInfo.attach('cancelled-import-storage-paths', {
    body: Buffer.from(
      JSON.stringify(
        cancelledAttempts.map((attempt) => attempt.pathname),
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
  await expect.poll(async () => (await storedObjectNames()).length).toBe(6);

  const cancelledImport = await loadCancelledImportForCleanup();
  expect(cancelledImport.cleanup_started_at).toBeNull();
  expect(cancelledImport.cleanup_not_before.getTime()).toBeGreaterThan(
    Date.now(),
  );
  await runImportCleanup(page, 0);
  await expectCancelledImportPresent(
    cancelledImport.batch_id,
    cancelledImport.entry_id,
  );
  await expect.poll(async () => (await storedObjectNames()).length).toBe(6);
  const stillFencedImport = await loadCancelledImportForCleanup();
  expect(stillFencedImport.batch_id).toBe(cancelledImport.batch_id);
  expect(stillFencedImport.cleanup_started_at).toBeNull();

  await releaseCancelledImportForCleanup(cancelledImport.batch_id);
  await runImportCleanup(page, 1);
  await expectCancelledImportRemoved(
    cancelledImport.batch_id,
    cancelledImport.entry_id,
  );
  await expect.poll(async () => (await storedObjectNames()).length).toBe(4);

  await page.goto('/dashboard/import', { waitUntil: 'networkidle' });
  await expect(page.getByLabel('Choose photos', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'An interrupted private upload is waiting.',
    }),
  ).toHaveCount(0);
  await auditCurrentPage(
    page,
    testInfo,
    'full-import-cancelled-draft-cleared',
    monitor,
    { accessibility: true },
  );

  for (const entryId of persistedChapter.entryIds) {
    await page.goto(`/dashboard?memory=${entryId}`);
    const memoryDialog = page.getByRole('dialog', { name: 'Edit memory' });
    await expect(memoryDialog).toBeVisible();
    await memoryDialog
      .getByRole('button', { name: 'Remove', exact: true })
      .click();
    await memoryDialog
      .getByRole('button', { name: 'Remove this memory?' })
      .click();
    await expect(memoryDialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole('status')).toContainText(
      'Memory removed from your atlas.',
    );
  }
  await expect.poll(async () => (await storedObjectNames()).length).toBe(0);
  await auditCurrentPage(
    page,
    testInfo,
    'full-import-storage-cleaned',
    monitor,
    {
      accessibility: true,
      readySelector: '[data-map-state="ready"]',
    },
  );
  monitor.stop();
});
