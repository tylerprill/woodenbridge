import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';

export const JOURNEY_START_SEGMENT_KEY = 'journey-start';

export type JourneyStop = AtlasJourneySummary['stops'][number];

export type JourneySegmentGroup = {
  key: string;
  eyebrow: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  stops: JourneyStop[];
};

function journeyStopDateRange(stops: JourneyStop[]) {
  const dates = stops
    .map((stop) => stop.visitedOn)
    .filter((date): date is string => Boolean(date))
    .sort();

  return {
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
  };
}

export function journeySegmentGroups(journey: AtlasJourneySummary) {
  if (!journey.segments.length) return [];

  const knownSegmentIds = new Set(
    journey.segments.map((segment) => segment.id),
  );
  const unassignedStops = journey.stops.filter(
    (stop) => !stop.segmentId || !knownSegmentIds.has(stop.segmentId),
  );
  const groups: JourneySegmentGroup[] = [];

  if (unassignedStops.length) {
    const range = journeyStopDateRange(unassignedStops);
    groups.push({
      key: JOURNEY_START_SEGMENT_KEY,
      eyebrow: 'Journey start',
      title: 'Before the first segment',
      startDate: range.startDate,
      endDate: range.endDate,
      stops: unassignedStops,
    });
  }

  journey.segments.forEach((segment) => {
    groups.push({
      key: segment.id,
      eyebrow: `Segment ${String(segment.position + 1).padStart(2, '0')}`,
      title: segment.title,
      startDate: segment.startDate,
      endDate: segment.endDate,
      stops: journey.stops.filter((stop) => stop.segmentId === segment.id),
    });
  });

  return groups;
}

export function journeySegmentKeyForStop(
  journey: AtlasJourneySummary,
  stopId: string | null,
) {
  if (!stopId || !journey.segments.length) return null;
  return (
    journeySegmentGroups(journey).find((group) =>
      group.stops.some((stop) => stop.entryId === stopId),
    )?.key ?? null
  );
}
