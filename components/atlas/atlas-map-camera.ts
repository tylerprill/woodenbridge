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
