export type AtlasMapPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type AtlasMapCoordinate = readonly [longitude: number, latitude: number];

export type AtlasJourneyLayout =
  'wide-right' | 'right' | 'bottom' | 'landscape';

const LONGITUDE_CIRCLE = 360;
const LONGITUDE_TIE_EPSILON = 1e-9;
const MERCATOR_WORLD_SIZE_AT_ZOOM_ZERO = 512;
const MERCATOR_MAX_LATITUDE = 85.0511287798066;
const DEGREES_TO_RADIANS = Math.PI / 180;
const JOURNEY_MIN_ZOOM = -2;
const JOURNEY_MAX_FIT_ZOOM = 8.5;
const JOURNEY_MARKER_FIT_INSET = 22;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeLongitude(longitude: number) {
  const normalized = longitude % LONGITUDE_CIRCLE;
  return normalized < 0 ? normalized + LONGITUDE_CIRCLE : normalized;
}

type LongitudeAlignment = {
  startLongitude: number;
  worldShift: number;
  displacement: number;
  center: number;
  start: number;
};

type LongitudeSample = {
  normalized: number;
  deltaFromOriginal: number;
};

function isBetterLongitudeAlignment(
  candidate: LongitudeAlignment,
  current: LongitudeAlignment | null,
) {
  if (!current) return true;
  if (candidate.displacement < current.displacement - LONGITUDE_TIE_EPSILON) {
    return true;
  }
  if (
    Math.abs(candidate.displacement - current.displacement) >
    LONGITUDE_TIE_EPSILON
  ) {
    return false;
  }

  // Equivalent world copies produce the same bounds. Prefer the copy closest
  // to the prime meridian, then the western copy, so ties never depend on the
  // order in which journeys happened to be loaded.
  if (
    Math.abs(candidate.center) <
    Math.abs(current.center) - LONGITUDE_TIE_EPSILON
  ) {
    return true;
  }
  if (
    Math.abs(Math.abs(candidate.center) - Math.abs(current.center)) >
    LONGITUDE_TIE_EPSILON
  ) {
    return false;
  }
  if (candidate.center < current.center - LONGITUDE_TIE_EPSILON) return true;
  if (Math.abs(candidate.center - current.center) > LONGITUDE_TIE_EPSILON) {
    return false;
  }
  return candidate.start < current.start;
}

/**
 * Places equivalent longitude world copies inside their smallest shared
 * circular envelope. This lets camera bounds fit routes around the date line
 * without mistaking a two-degree crossing for a nearly global span.
 */
export function alignCoordinatesToMinimalLongitudeEnvelope(
  coordinates: readonly AtlasMapCoordinate[],
): [longitude: number, latitude: number][] {
  if (coordinates.length < 2) {
    return coordinates.map(([longitude, latitude]) => [longitude, latitude]);
  }

  let totalDeltaFromOriginal = 0;
  let totalSquaredDeltaFromOriginal = 0;
  const sortedSamples = coordinates
    .map<LongitudeSample>(([longitude]) => {
      const normalized = normalizeLongitude(longitude);
      const deltaFromOriginal = normalized - longitude;
      totalDeltaFromOriginal += deltaFromOriginal;
      totalSquaredDeltaFromOriginal += deltaFromOriginal * deltaFromOriginal;
      return { normalized, deltaFromOriginal };
    })
    .sort((first, second) => first.normalized - second.normalized);
  let largestGap = -Infinity;

  for (let index = 0; index < sortedSamples.length; index += 1) {
    const longitude = sortedSamples[index].normalized;
    const next =
      index === sortedSamples.length - 1
        ? sortedSamples[0].normalized + LONGITUDE_CIRCLE
        : sortedSamples[index + 1].normalized;
    largestGap = Math.max(largestGap, next - longitude);
  }

  let best: LongitudeAlignment | null = null;
  let prefixDeltaFromOriginal = 0;

  for (let index = 0; index < sortedSamples.length; index += 1) {
    prefixDeltaFromOriginal += sortedSamples[index].deltaFromOriginal;
    const wrapsCircle = index === sortedSamples.length - 1;
    const nextIndex = wrapsCircle ? 0 : index + 1;
    const longitude = sortedSamples[index].normalized;
    const nextLongitude =
      sortedSamples[nextIndex].normalized +
      (wrapsCircle ? LONGITUDE_CIRCLE : 0);
    const gap = nextLongitude - longitude;
    if (largestGap - gap > LONGITUDE_TIE_EPSILON) continue;

    const startLongitude = sortedSamples[nextIndex].normalized;
    const shiftedSampleCount = wrapsCircle ? 0 : index + 1;
    const shiftedDeltaFromOriginal = wrapsCircle ? 0 : prefixDeltaFromOriginal;
    const baseDeltaFromOriginal =
      totalDeltaFromOriginal + LONGITUDE_CIRCLE * shiftedSampleCount;
    const baseSquaredDeltaFromOriginal =
      totalSquaredDeltaFromOriginal +
      2 * LONGITUDE_CIRCLE * shiftedDeltaFromOriginal +
      LONGITUDE_CIRCLE * LONGITUDE_CIRCLE * shiftedSampleCount;
    const idealWorldShift =
      -baseDeltaFromOriginal / (LONGITUDE_CIRCLE * sortedSamples.length);
    const worldShifts = Array.from(
      new Set([Math.floor(idealWorldShift), Math.ceil(idealWorldShift)]),
    );
    const west = startLongitude;
    const east = wrapsCircle
      ? (sortedSamples.at(-1)?.normalized ?? west)
      : longitude + LONGITUDE_CIRCLE;

    for (const worldShift of worldShifts) {
      const shift = worldShift * LONGITUDE_CIRCLE;
      const displacement =
        baseSquaredDeltaFromOriginal +
        2 * shift * baseDeltaFromOriginal +
        sortedSamples.length * shift * shift;
      const candidate = {
        startLongitude,
        worldShift,
        displacement,
        center: (west + east) / 2 + shift,
        start: startLongitude + shift,
      };
      if (isBetterLongitudeAlignment(candidate, best)) best = candidate;
    }
  }

  return coordinates.map(([longitude, latitude]) => {
    if (!best) return [longitude, latitude];
    const normalized = normalizeLongitude(longitude);
    const baseLongitude =
      normalized < best.startLongitude
        ? normalized + LONGITUDE_CIRCLE
        : normalized;
    return [baseLongitude + best.worldShift * LONGITUDE_CIRCLE, latitude];
  });
}

/**
 * Places coordinates in the world copy already selected for a fitted route.
 * Use the complete sampled route envelope, not a second stop-only envelope,
 * so fresh DOM markers share the same physical endpoints as the route lines.
 */
export function alignCoordinatesToLongitudeEnvelope(
  coordinates: readonly AtlasMapCoordinate[],
  envelopeCoordinates: readonly AtlasMapCoordinate[],
): [longitude: number, latitude: number][] {
  let west = Infinity;
  let east = -Infinity;
  for (const [longitude] of envelopeCoordinates) {
    if (!Number.isFinite(longitude)) continue;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  if (!Number.isFinite(west) || !Number.isFinite(east)) {
    return coordinates.map(([longitude, latitude]) => [longitude, latitude]);
  }

  const center = west / 2 + east / 2;
  return coordinates.map(([longitude, latitude]) => [
    Number.isFinite(longitude)
      ? longitude +
        LONGITUDE_CIRCLE * Math.round((center - longitude) / LONGITUDE_CIRCLE)
      : longitude,
    latitude,
  ]);
}

/**
 * MapLibre's globe fit refines against the full canvas, not the retained
 * Journey inset. Bound its globe radius against every sampled route point in
 * that exposed region, using the same zero-pitch/zero-bearing perspective.
 * The candidate center must be the unshifted, retained-padding bounds center.
 * Points behind its hemisphere cannot all become visible at any finite zoom;
 * in that case fit the complete globe silhouette instead of shrinking toward
 * its minimum radius. Back-side dots and route strands remain globe-occluded.
 */
export function getAtlasJourneyGlobeFitZoomLimit(
  coordinates: readonly AtlasMapCoordinate[],
  width: number,
  height: number,
  padding: AtlasMapPadding,
  candidateCenter: AtlasMapCoordinate,
  verticalFovDegrees: number,
): number {
  if (!coordinates.length) return JOURNEY_MAX_FIT_ZOOM;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 2 ||
    height <= 2 ||
    !Number.isFinite(candidateCenter[0]) ||
    !Number.isFinite(candidateCenter[1]) ||
    !Number.isFinite(verticalFovDegrees) ||
    Object.values(padding).some(
      (inset) => !Number.isFinite(inset) || inset < 0,
    ) ||
    width - padding.left - padding.right < 2 ||
    height - padding.top - padding.bottom < 2
  ) {
    return JOURNEY_MIN_ZOOM;
  }

  const halfWidth = Math.max(2, width - padding.left - padding.right) / 2;
  const halfHeight = Math.max(2, height - padding.top - padding.bottom) / 2;
  const centerLongitude = normalizeLongitude(candidateCenter[0]);
  // Match MapLibre's default globe-center constraint, but preserve the actual
  // +/-90-degree sample latitude so pole vertices are included exactly.
  const centerLatitude =
    clamp(candidateCenter[1], -MERCATOR_MAX_LATITUDE, MERCATOR_MAX_LATITUDE) *
    DEGREES_TO_RADIANS;
  const centerSin = Math.sin(centerLatitude);
  const centerCos = Math.cos(centerLatitude);
  // Globe's minimum geographical zoom is latitude-compensated: the same
  // configured -2 floor means the same minimum planet radius near a pole.
  const minimumZoom = JOURNEY_MIN_ZOOM + Math.log2(centerCos);
  const fieldOfView = clamp(verticalFovDegrees, 0.1, 150) * DEGREES_TO_RADIANS;
  const cameraDistance = height / (2 * Math.tan(fieldOfView / 2));
  let radiusLimit = Infinity;
  let needsWholeGlobeOverview = false;

  for (const [longitude, latitude] of coordinates) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return minimumZoom;
    }
    const latitudeRadians = clamp(latitude, -90, 90) * DEGREES_TO_RADIANS;
    const longitudeDelta =
      (normalizeLongitude(longitude) - centerLongitude) * DEGREES_TO_RADIANS;
    const latitudeSin = Math.sin(latitudeRadians);
    const latitudeCos = Math.cos(latitudeRadians);
    const longitudeCos = Math.cos(longitudeDelta);
    const horizontal = latitudeCos * Math.sin(longitudeDelta);
    const vertical =
      latitudeSin * centerCos - latitudeCos * longitudeCos * centerSin;
    const centerDot = clamp(
      latitudeSin * centerSin + latitudeCos * longitudeCos * centerCos,
      -1,
      1,
    );
    const depth = 1 - centerDot;
    if (centerDot <= 1e-12) {
      needsWholeGlobeOverview = true;
      continue;
    }

    // A point projects at u * R * D / (D + R * depth). Solving its
    // displacement <= available half-dimension gives these radius caps.
    const horizontalDenominator =
      Math.abs(horizontal) * cameraDistance - halfWidth * depth;
    if (horizontalDenominator > 0) {
      radiusLimit = Math.min(
        radiusLimit,
        (halfWidth * cameraDistance) / horizontalDenominator,
      );
    }
    const verticalDenominator =
      Math.abs(vertical) * cameraDistance - halfHeight * depth;
    if (verticalDenominator > 0) {
      radiusLimit = Math.min(
        radiusLimit,
        (halfHeight * cameraDistance) / verticalDenominator,
      );
    }

    // A geometrically in-bounds point can still be occluded by the sphere.
    // For front-side samples, R <= D * dot / (1 - dot) keeps line of sight
    // outside the globe. Leave a tiny margin at the exact horizon.
    if (depth > 0) {
      radiusLimit = Math.min(
        radiusLimit,
        ((cameraDistance * centerDot) / depth) * (1 - 1e-6),
      );
    }
  }

  if (needsWholeGlobeOverview) {
    // The projected sphere silhouette has apparent radius
    // a = D * R / sqrt(D² + 2DR). Invert it to fit the complete planet in
    // the exposed region; this does not promise visibility of its back side.
    const apparentRadius = Math.min(halfWidth, halfHeight);
    radiusLimit =
      (apparentRadius * apparentRadius +
        apparentRadius * Math.hypot(apparentRadius, cameraDistance)) /
      cameraDistance;
  }

  // MapLibre scales globe radius by latitude to retain local Mercator scale.
  const worldSizeLimit = radiusLimit * 2 * Math.PI * centerCos;
  return clamp(
    Math.log2(worldSizeLimit / MERCATOR_WORLD_SIZE_AT_ZOOM_ZERO),
    minimumZoom,
    JOURNEY_MAX_FIT_ZOOM,
  );
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
 * Journey panels use a right dock on medium/wide canvases, a bottom sheet on
 * narrow canvases, and a compact rail in short landscape. Prefer the live CSS
 * layout: a short map canvas does not imply a short landscape viewport.
 */
export function getAtlasJourneyFocusPadding(
  width: number,
  height: number,
  playback = false,
  layout?: AtlasJourneyLayout,
): AtlasMapPadding {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const horizontalBudget = Math.max(0, safeWidth - 2);
  const resolvedLayout =
    layout ??
    (safeHeight <= 480 && safeWidth > 480
      ? 'landscape'
      : safeWidth <= 640
        ? 'bottom'
        : safeWidth > 896
          ? 'wide-right'
          : 'right');

  if (resolvedLayout === 'landscape') {
    const top = Math.min(90, Math.max(0, Math.floor((safeHeight - 2) / 2)));
    const bottom = Math.min(80, Math.max(0, safeHeight - top - 2));
    const left = Math.min(48, Math.floor(horizontalBudget / 2));
    const panelWidth = Math.min(352, Math.max(0, safeWidth - 90));
    const right = Math.min(
      panelWidth + 34,
      Math.max(0, horizontalBudget - left),
    );
    return { top, right, bottom, left };
  }
  if (resolvedLayout === 'right' || resolvedLayout === 'wide-right') {
    const wide = resolvedLayout === 'wide-right';
    const top = Math.min(
      wide ? 190 : 170,
      Math.max(0, Math.floor((safeHeight - 2) / 2)),
    );
    const bottom = Math.min(80, Math.max(0, safeHeight - top - 2));
    const left = Math.min(wide ? 112 : 24, Math.floor(horizontalBudget / 2));
    const panelWidth = Math.min(384, safeWidth * 0.4);
    const right = Math.min(
      Math.ceil(panelWidth + (wide ? 20 : 12) + 16),
      Math.max(0, horizontalBudget - left),
    );
    return { top, right, bottom, left };
  }

  const base = getAtlasFitPadding(safeWidth, safeHeight);
  const sheetTop = Math.min(
    Math.max(playback ? 56 : 18, Math.round(safeHeight * 0.06)),
    Math.max(0, safeHeight - 2),
  );
  // Portrait playback trays can reach 76% of the workspace. A proportional
  // inset alone loses complete-dot clearance on short canvases, so also solve
  // for a 22px marker radius, 9px sheet gap, 8px gutter and rounding allowance.
  const desiredBottom = playback
    ? Math.max(
        Math.round(safeHeight * 0.78) + 10,
        Math.ceil(safeHeight * 0.52 + sheetTop + 80),
      )
    : Math.round(safeHeight * 0.64);
  const sheetBottom = Math.min(
    desiredBottom,
    Math.max(0, safeHeight - sheetTop - 2),
  );
  return { ...base, top: sheetTop, bottom: sheetBottom };
}

/** Leaves complete route dots clear of Journey overlays, not only their centers. */
export function getAtlasJourneyFitPadding(
  width: number,
  height: number,
  layout?: AtlasJourneyLayout,
): AtlasMapPadding {
  const base = getAtlasJourneyFocusPadding(width, height, false, layout);
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  const horizontalInset = Math.min(
    JOURNEY_MARKER_FIT_INSET,
    Math.max(0, (safeWidth - base.left - base.right - 2) / 2),
  );
  const verticalInset = Math.min(
    JOURNEY_MARKER_FIT_INSET,
    Math.max(0, (safeHeight - base.top - base.bottom - 2) / 2),
  );
  return {
    top: base.top + Math.floor(verticalInset),
    right: base.right + Math.floor(horizontalInset),
    bottom: base.bottom + Math.floor(verticalInset),
    left: base.left + Math.floor(horizontalInset),
  };
}
