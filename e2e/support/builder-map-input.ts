import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

/** Read painted pins/clusters without exposing or mocking MapLibre internals. */
async function paintedBuilderTargets(page: Page, screenshotPath: string) {
  const canvas = await page.locator('.maplibregl-canvas').boundingBox();
  const viewport = page.viewportSize();
  expect(canvas).not.toBeNull();
  if (!canvas || !viewport) throw new Error('Builder canvas is not available');
  const { data, info } = await sharp(screenshotPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scale = info.width / viewport.width;
  const pixels = new Map<number, 'pin' | 'cluster'>();
  for (
    let y = Math.ceil(canvas.y * scale);
    y < (canvas.y + canvas.height) * scale;
    y++
  ) {
    for (
      let x = Math.ceil(canvas.x * scale);
      x < (canvas.x + canvas.width) * scale;
      x++
    ) {
      const index = y * info.width + x;
      const offset = index * info.channels;
      const [red, green, blue] = [
        data[offset],
        data[offset + 1],
        data[offset + 2],
      ];
      // Allow the Atlas' saturation/sepia filter and grain, while distinguishing
      // warm unselected pins from its neutral basemap and green clusters.
      if (
        Math.abs(red - 182) <= 25 &&
        Math.abs(green - 109) <= 25 &&
        Math.abs(blue - 66) <= 25 &&
        red - green > 40 &&
        green - blue > 15
      ) {
        pixels.set(index, 'pin');
      } else if (
        red <= 55 &&
        green <= 80 &&
        blue <= 75 &&
        green - red >= 10 &&
        green - blue >= 3
      ) {
        pixels.set(index, 'cluster');
      }
    }
  }
  const candidates: {
    x: number;
    y: number;
    area: number;
    radius: number;
    kind: 'pin' | 'cluster';
  }[] = [];
  while (pixels.size) {
    const first = pixels.keys().next().value as number;
    const kind = pixels.get(first)!;
    const pending = [first];
    pixels.delete(first);
    let left = info.width,
      right = 0,
      top = info.height,
      bottom = 0;
    let xSum = 0,
      ySum = 0,
      area = 0;
    while (pending.length) {
      const index = pending.pop()!;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      xSum += x;
      ySum += y;
      area++;
      for (const neighbor of [
        index - 1,
        index + 1,
        index - info.width,
        index + info.width,
      ]) {
        if (pixels.get(neighbor) === kind && pixels.delete(neighbor)) {
          pending.push(neighbor);
        }
      }
    }
    const width = (right - left + 1) / scale;
    const height = (bottom - top + 1) / scale;
    if (
      area >= (kind === 'pin' ? 24 : 120) * scale * scale &&
      width >= (kind === 'pin' ? 7 : 18) &&
      height >= (kind === 'pin' ? 7 : 18) &&
      width <= (kind === 'pin' ? 22 : 60) &&
      height <= (kind === 'pin' ? 22 : 60)
    ) {
      const x = xSum / area / scale;
      const y = ySum / area / scale;
      candidates.push({
        x,
        y,
        area,
        radius: Math.max(22, width / 2, height / 2),
        kind,
      });
    }
  }
  candidates.sort(
    (first, second) => second.area - first.area || first.x - second.x,
  );
  return { canvas, candidates };
}

/** Locate an actual unselected pin with room for a buffered tap. */
export async function visibleBuilderPin(page: Page, screenshotPath: string) {
  const { canvas, candidates } = await paintedBuilderTargets(
    page,
    screenshotPath,
  );
  const pins = candidates.filter(
    ({ kind, x, y }) =>
      kind === 'pin' &&
      x - 22 > canvas.x &&
      x + 22 < canvas.x + canvas.width &&
      y > canvas.y + 65 &&
      y + 22 < canvas.y + canvas.height,
  );
  expect(
    pins.length,
    'An actual unselected map pin is available to tap',
  ).toBeGreaterThan(0);
  return pins[0];
}

/** Painted pins/clusters retain their full touch target outside map controls. */
export async function expectBuilderMapTargetsClear(
  page: Page,
  screenshotPath: string,
) {
  const { candidates } = await paintedBuilderTargets(page, screenshotPath);
  expect(
    candidates.length,
    'Actual painted builder targets are visible',
  ).toBeGreaterThan(0);
  const overlays = await Promise.all([
    page.locator('.maplibregl-ctrl-attrib').boundingBox(),
    page
      .getByRole('button', { name: 'Fit memories on map', exact: true })
      .boundingBox(),
  ]);
  const errors: string[] = [];
  // Adjacent Mercator world copies naturally clip at the canvas edge. This
  // pixel assertion checks control occlusion, including those copies; fitted
  // camera gutters and map/panel clipping are verified separately.
  for (const { kind, x, y, radius } of candidates) {
    for (const overlay of overlays) {
      if (
        overlay &&
        x - radius < overlay.x + overlay.width &&
        x + radius > overlay.x &&
        y - radius < overlay.y + overlay.height &&
        y + radius > overlay.y
      ) {
        errors.push(`${kind} touch target overlaps map controls`);
      }
    }
  }
  expect(errors, 'Painted builder touch targets stay fully clear').toEqual([]);
}

/** Tap outside the small painted circle, exercising the full 44px input area. */
export async function toggleVisibleBuilderPin(
  page: Page,
  screenshotPath: string,
) {
  const point = await visibleBuilderPin(page, screenshotPath);
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  const tap = () =>
    touch
      ? page.touchscreen.tap(point.x + 14, point.y)
      : page.mouse.click(point.x + 14, point.y);
  await tap();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await tap();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
}
