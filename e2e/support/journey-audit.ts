import { expect, type Page } from '@playwright/test';

/** Check the complete hit target, not only the center of the numbered dot. */
export async function expectActiveJourneyDotClearOfOverlays(page: Page) {
  const marker = page.locator('button.maplibregl-marker[aria-current="step"]');
  await expect(marker).toHaveCount(1);

  await expect
    .poll(
      () =>
        marker.evaluate((activeDot) => {
          const errors: string[] = [];
          const dotBounds = activeDot.getBoundingClientRect();
          const dotStyle = getComputedStyle(activeDot);
          const mapBounds = activeDot
            .closest('.maplibregl-map')
            ?.getBoundingClientRect();
          if (
            !dotBounds.width ||
            !dotBounds.height ||
            dotStyle.visibility !== 'visible' ||
            Number(dotStyle.opacity) === 0
          ) {
            errors.push('active dot is not visible');
          }
          if (
            !mapBounds ||
            dotBounds.left < mapBounds.left ||
            dotBounds.right > mapBounds.right ||
            dotBounds.top < mapBounds.top ||
            dotBounds.bottom > mapBounds.bottom
          ) {
            errors.push('active dot is clipped by the map');
          }

          const overlays = [
            {
              name: 'Journey playback panel',
              element: document.querySelector(
                'section[aria-labelledby="journey-playback-title"]',
              ),
            },
            {
              name: 'Journey lens header',
              element: document.querySelector(
                '[role="group"][aria-label="Atlas view"]',
              )?.parentElement,
            },
          ];
          for (const { name, element } of overlays) {
            if (!element) continue;
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            if (
              style.display === 'none' ||
              style.visibility !== 'visible' ||
              Number(style.opacity) === 0 ||
              !bounds.width ||
              !bounds.height
            ) {
              continue;
            }
            const overlaps =
              dotBounds.left < bounds.right &&
              dotBounds.right > bounds.left &&
              dotBounds.top < bounds.bottom &&
              dotBounds.bottom > bounds.top;
            if (overlaps) errors.push(`active dot overlaps ${name}`);
          }
          return errors;
        }),
      { message: 'The entire active Journey dot stays clear of both overlays' },
    )
    .toEqual([]);
}
