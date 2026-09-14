export type AtlasMapPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Keeps route-fit padding proportional to the live canvas. MapLibre rejects a
 * camera fit when opposing padding consumes the complete width or height,
 * which is easy to trigger in the compact mobile journey map.
 */
export function getAtlasFitPadding(
  width: number,
  height: number,
): AtlasMapPadding {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const horizontalBudget = Math.max(0, Math.floor((safeWidth - 2) / 2));
  const horizontal = Math.min(
    horizontalBudget,
    clamp(Math.round(safeWidth * 0.12), 18, 120),
  );

  const verticalBudget = Math.max(0, Math.floor(safeHeight - 2));
  const desiredTop = clamp(Math.round(safeHeight * 0.16), 18, 170);
  const desiredBottom = clamp(Math.round(safeHeight * 0.28), 28, 140);
  const desiredTotal = desiredTop + desiredBottom;
  const scale =
    desiredTotal > verticalBudget ? verticalBudget / desiredTotal : 1;
  const top = Math.floor(desiredTop * scale);
  const bottom = Math.min(
    verticalBudget - top,
    Math.floor(desiredBottom * scale),
  );

  return { top, right: horizontal, bottom, left: horizontal };
}

/**
 * Keeps a selected pin visible beside the desktop memory drawer without
 * feeding MapLibre impossible padding on a phone-sized canvas.
 */
export function getAtlasFocusPadding(
  width: number,
  height: number,
  overlaySide: 'left' | 'right' = 'right',
  compactBreakpoint = 760,
): AtlasMapPadding {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;

  if (safeWidth <= compactBreakpoint) {
    return getAtlasFitPadding(safeWidth, safeHeight);
  }

  const left = Math.min(80, Math.max(0, Math.floor((safeWidth - 2) / 2)));
  const right = Math.min(360, Math.max(0, safeWidth - left - 2));
  const top = Math.min(90, Math.max(0, Math.floor((safeHeight - 2) / 2)));
  const bottom = Math.min(80, Math.max(0, safeHeight - top - 2));

  return overlaySide === 'left'
    ? { top, right: left, bottom, left: right }
    : { top, right, bottom, left };
}

/**
 * Journey panels use a left rail on medium/wide canvases, a bottom sheet on
 * narrow canvases, and a right rail in short landscape. Keep the active stop
 * inside the actually visible map region for each layout.
 */
export function getAtlasJourneyFocusPadding(
  width: number,
  height: number,
): AtlasMapPadding {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const horizontalBudget = Math.max(0, safeWidth - 2);
  const top = Math.min(90, Math.max(0, Math.floor((safeHeight - 2) / 2)));
  const bottom = Math.min(80, Math.max(0, safeHeight - top - 2));

  if (safeHeight <= 480 && safeWidth > 480) {
    const left = Math.min(48, Math.floor(horizontalBudget / 2));
    const panelWidth = Math.min(352, Math.max(0, safeWidth - 90));
    const right = Math.min(
      panelWidth + 34,
      Math.max(0, horizontalBudget - left),
    );
    return { top, right, bottom, left };
  }
  if (safeWidth > 640) {
    const right = Math.min(64, Math.floor(horizontalBudget / 2));
    const left = Math.min(
      safeWidth > 896 ? 538 : 420,
      Math.max(0, horizontalBudget - right),
    );
    return { top, right, bottom, left };
  }

  const base = getAtlasFitPadding(safeWidth, safeHeight);
  const sheetTop = Math.min(
    Math.max(18, Math.round(safeHeight * 0.06)),
    Math.max(0, safeHeight - 2),
  );
  const sheetBottom = Math.min(
    Math.round(safeHeight * 0.64),
    Math.max(0, safeHeight - sheetTop - 2),
  );
  return { ...base, top: sheetTop, bottom: sheetBottom };
}
