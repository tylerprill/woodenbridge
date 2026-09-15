import { expect, type Page } from '@playwright/test';

/** A scrollable details preview must not collapse beneath the fixed controls. */
export async function expectJourneyPlaybackPreviewHasRoom(page: Page) {
  const details = page
    .locator('section[aria-labelledby="journey-playback-title"]')
    .getByRole('region', { name: /^Stop \d+ details$/ });
  await expect(details).toBeVisible();
  await expect
    .poll(async () => (await details.boundingBox())?.height ?? 0, {
      message: 'Playback retains at least a touch-sized details preview',
    })
    .toBeGreaterThanOrEqual(44);
}

async function expectJourneyDotsClearOfOverlays(
  page: Page,
  currentOnly: boolean,
) {
  const markers = page.locator(
    currentOnly
      ? 'button.maplibregl-marker[aria-current="step"]'
      : 'button.maplibregl-marker[aria-label^="Stop "]',
  );
  if (currentOnly) await expect(markers).toHaveCount(1);
  else await expect(markers.first()).toBeAttached();

  await expect
    .poll(
      () =>
        markers.evaluateAll((dots, requireCurrent) => {
          const errors: string[] = [];
          if (!dots.length || (requireCurrent && dots.length !== 1)) {
            return ['Expected Journey dots are missing'];
          }
          const overlays = [
            {
              name: 'Journey playback panel',
              element: document.querySelector(
                'section[aria-labelledby="journey-playback-title"]',
              ),
            },
            {
              name: 'Remembered Path inspector',
              element: document.querySelector(
                'section[aria-labelledby="journey-tray-title"]',
              ),
            },
            {
              name: 'Journey lens header',
              element: document.querySelector(
                '[role="group"][aria-label="Atlas view"]',
              )?.parentElement,
            },
            {
              name: 'Journey tools',
              element: document.querySelector(
                '[role="toolbar"][aria-label="Journey tools"]',
              ),
            },
            {
              name: 'Atlas search',
              element: document.querySelector('#atlas-search')?.parentElement,
            },
            {
              name: 'Map attribution',
              element: document.querySelector('.maplibregl-ctrl-attrib'),
            },
          ];
          const visibleOverlays = overlays.flatMap(({ name, element }) => {
            if (!element) return [];
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return style.display === 'none' ||
              style.visibility !== 'visible' ||
              Number(style.opacity) === 0 ||
              !bounds.width ||
              !bounds.height
              ? []
              : [{ name, bounds }];
          });
          const attribution = visibleOverlays.find(
            ({ name }) => name === 'Map attribution',
          );
          if (attribution) {
            for (const { name, bounds } of visibleOverlays) {
              if (
                (name === 'Journey playback panel' ||
                  name === 'Remembered Path inspector') &&
                attribution.bounds.left < bounds.right &&
                attribution.bounds.right > bounds.left &&
                attribution.bounds.top < bounds.bottom &&
                attribution.bounds.bottom > bounds.top
              ) {
                errors.push(`Map attribution overlaps ${name}`);
              }
            }
          }
          for (const dot of dots) {
            const label = dot.getAttribute('aria-label') ?? 'Journey dot';
            const dotBounds = dot.getBoundingClientRect();
            const dotStyle = getComputedStyle(dot);
            const visible =
              dotStyle.display !== 'none' &&
              dotStyle.visibility === 'visible' &&
              Number(dotStyle.opacity) > 0 &&
              dotBounds.width > 0 &&
              dotBounds.height > 0;
            if (!visible) {
              if (requireCurrent) errors.push(`${label} is not visible`);
              continue;
            }
            const mapBounds = dot
              .closest('.maplibregl-map')
              ?.getBoundingClientRect();
            if (
              !mapBounds ||
              dotBounds.left < mapBounds.left ||
              dotBounds.right > mapBounds.right ||
              dotBounds.top < mapBounds.top ||
              dotBounds.bottom > mapBounds.bottom
            ) {
              errors.push(`${label} is clipped by the map`);
            }
            for (const { name, bounds } of visibleOverlays) {
              const overlaps =
                dotBounds.left < bounds.right &&
                dotBounds.right > bounds.left &&
                dotBounds.top < bounds.bottom &&
                dotBounds.bottom > bounds.top;
              if (overlaps) errors.push(`${label} overlaps ${name}`);
            }
          }
          return errors;
        }, currentOnly),
      { message: 'Complete visible Journey dots stay clear of Atlas overlays' },
    )
    .toEqual([]);
}

/** Check the complete hit target, not only the center of the numbered dot. */
export async function expectActiveJourneyDotClearOfOverlays(page: Page) {
  await expectJourneyDotsClearOfOverlays(page, true);
}

/** Globe-occluded dots are skipped; every actually visible fitted dot is checked. */
export async function expectVisibleJourneyDotsClearOfOverlays(page: Page) {
  await expectJourneyDotsClearOfOverlays(page, false);
}
