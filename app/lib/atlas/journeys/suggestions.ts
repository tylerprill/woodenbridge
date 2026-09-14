import 'server-only';

import { createHash } from 'node:crypto';

import type {
  AtlasJourneySuggestion,
  AtlasJourneySuggestionSource,
} from './definitions';

export const ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION = 1;
export const ATLAS_JOURNEY_MAX_SUGGESTIONS = 3;
export const ATLAS_JOURNEY_SUGGESTION_CANDIDATE_LIMIT = 1000;

const MAX_PAIR_DATE_GAP_DAYS = 3;
const MAX_GROUP_DATE_SPAN_DAYS = 7;
const MAX_PAIR_DISTANCE_KM = 160;
const MAX_MEMORIES_PER_SUGGESTION = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;

export type AtlasJourneySuggestionCandidate = {
  entryId: string;
  version: number;
  title: string;
  placeLabel: string;
  placeName: string | null;
  placeLocality: string | null;
  placeRegion: string | null;
  placeCountry: string | null;
  visitedOn: string | null;
  latitude: number;
  longitude: number;
};

export type AtlasJourneyImportSuggestionCandidate = {
  batchId: string;
  completedAt: string;
  entries: Array<AtlasJourneySuggestionCandidate & { position: number }>;
};

function dateValue(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function dateGapDays(first: string, second: string) {
  return Math.abs(dateValue(first) - dateValue(second)) / DAY_MS;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function atlasJourneyDistanceKm(
  first: Pick<AtlasJourneySuggestionCandidate, 'latitude' | 'longitude'>,
  second: Pick<AtlasJourneySuggestionCandidate, 'latitude' | 'longitude'>,
) {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  let longitudeDelta = second.longitude - first.longitude;
  while (longitudeDelta > 180) longitudeDelta -= 360;
  while (longitudeDelta < -180) longitudeDelta += 360;

  const longitudeDeltaRadians = toRadians(longitudeDelta);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDeltaRadians / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function suggestionKey(
  source: AtlasJourneySuggestionSource,
  entries: AtlasJourneySuggestionCandidate[],
) {
  const members = entries
    .map((entry) => `${entry.entryId}:${entry.version}`)
    .sort()
    .join('|');
  return createHash('sha256')
    .update(
      `field-atlas:journey-suggestion:v${ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION}:${source}:${members}`,
    )
    .digest('hex');
}

function dominantPlace(entries: AtlasJourneySuggestionCandidate[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const place =
      entry.placeLocality ||
      entry.placeRegion ||
      entry.placeCountry ||
      entry.placeName ||
      entry.placeLabel;
    if (!place) continue;
    counts.set(place, (counts.get(place) ?? 0) + 1);
  }

  return (
    Array.from(counts.entries()).sort(
      ([firstPlace, firstCount], [secondPlace, secondCount]) =>
        secondCount - firstCount || firstPlace.localeCompare(secondPlace),
    )[0]?.[0] ?? 'your atlas'
  );
}

function dateRange(entries: AtlasJourneySuggestionCandidate[]) {
  const dates = entries
    .map((entry) => entry.visitedOn)
    .filter((date): date is string => Boolean(date))
    .sort();
  return {
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
  };
}

function buildSuggestion(
  source: AtlasJourneySuggestionSource,
  entries: AtlasJourneySuggestionCandidate[],
): AtlasJourneySuggestion {
  const place = dominantPlace(entries);
  const { startDate, endDate } = dateRange(entries);
  const daySpan =
    startDate && endDate ? Math.round(dateGapDays(startDate, endDate)) + 1 : 1;
  const imported = source === 'photo_import';

  return {
    key: suggestionKey(source, entries),
    algorithmVersion: ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION,
    source,
    reason: imported ? 'imported_together' : 'nearby_dates_and_places',
    explanation: imported
      ? `These ${entries.length} memories were imported together.`
      : daySpan === 1
        ? `These ${entries.length} memories share a date and are near ${place}.`
        : `These ${entries.length} memories are dated within ${daySpan} days and are near ${place}.`,
    suggestedTitle: `${place} memories`,
    startDate,
    endDate,
    memoryCount: entries.length,
    entryIds: entries.map((entry) => entry.entryId),
  };
}

export function buildImportJourneySuggestions(
  batches: AtlasJourneyImportSuggestionCandidate[],
) {
  return batches
    .map((batch) => ({
      batch,
      entries: [...batch.entries]
        .sort(
          (first, second) =>
            first.position - second.position ||
            first.entryId.localeCompare(second.entryId),
        )
        .slice(0, MAX_MEMORIES_PER_SUGGESTION),
    }))
    .filter(({ entries }) => entries.length >= 2)
    .sort(
      (first, second) =>
        second.batch.completedAt.localeCompare(first.batch.completedAt) ||
        first.batch.batchId.localeCompare(second.batch.batchId),
    )
    .map(({ entries }) => buildSuggestion('photo_import', entries));
}

class DisjointSet {
  private readonly parents: number[];

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    const parent = this.parents[value];
    if (parent === value) return value;
    const root = this.find(parent);
    this.parents[value] = root;
    return root;
  }

  union(first: number, second: number) {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot !== secondRoot) this.parents[secondRoot] = firstRoot;
  }
}

export function buildHistoricalJourneySuggestions(
  candidates: AtlasJourneySuggestionCandidate[],
) {
  const entries = [...candidates]
    .filter(
      (
        entry,
      ): entry is AtlasJourneySuggestionCandidate & {
        visitedOn: string;
      } =>
        Boolean(entry.visitedOn) &&
        Number.isFinite(entry.latitude) &&
        Number.isFinite(entry.longitude) &&
        Number.isFinite(dateValue(entry.visitedOn as string)),
    )
    .sort(
      (first, second) =>
        first.visitedOn.localeCompare(second.visitedOn) ||
        first.entryId.localeCompare(second.entryId),
    )
    .slice(-ATLAS_JOURNEY_SUGGESTION_CANDIDATE_LIMIT);
  const groups = new DisjointSet(entries.length);

  // The input is strictly bounded. Date ordering lets the inner scan stop as
  // soon as candidates exceed the conservative temporal window.
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < entries.length;
      secondIndex += 1
    ) {
      const gap = dateGapDays(
        entries[firstIndex].visitedOn,
        entries[secondIndex].visitedOn,
      );
      if (gap > MAX_PAIR_DATE_GAP_DAYS) break;
      if (
        atlasJourneyDistanceKm(entries[firstIndex], entries[secondIndex]) <=
        MAX_PAIR_DISTANCE_KM
      ) {
        groups.union(firstIndex, secondIndex);
      }
    }
  }

  const connected = new Map<number, Array<(typeof entries)[number]>>();
  entries.forEach((entry, index) => {
    const root = groups.find(index);
    const group = connected.get(root) ?? [];
    group.push(entry);
    connected.set(root, group);
  });

  const boundedGroups = Array.from(connected.values()).flatMap((group) => {
    const chunks: Array<Array<(typeof entries)[number]>> = [];
    let chunk: Array<(typeof entries)[number]> = [];
    for (const entry of group) {
      const exceedsDateSpan =
        chunk.length > 0 &&
        dateGapDays(chunk[0].visitedOn, entry.visitedOn) >
          MAX_GROUP_DATE_SPAN_DAYS;
      if (exceedsDateSpan || chunk.length === MAX_MEMORIES_PER_SUGGESTION) {
        if (chunk.length >= 2) chunks.push(chunk);
        chunk = [];
      }
      chunk.push(entry);
    }
    if (chunk.length >= 2) chunks.push(chunk);
    return chunks;
  });

  return boundedGroups
    .sort((first, second) => {
      const firstEnd = first.at(-1)?.visitedOn ?? '';
      const secondEnd = second.at(-1)?.visitedOn ?? '';
      return (
        secondEnd.localeCompare(firstEnd) ||
        second.length - first.length ||
        first[0].entryId.localeCompare(second[0].entryId)
      );
    })
    .map((group) => buildSuggestion('atlas_history', group));
}

export function selectAtlasJourneySuggestions({
  imports,
  historical,
  excludedKeys = new Set<string>(),
  limit = ATLAS_JOURNEY_MAX_SUGGESTIONS,
}: {
  imports: AtlasJourneySuggestion[];
  historical: AtlasJourneySuggestion[];
  excludedKeys?: ReadonlySet<string>;
  limit?: number;
}) {
  if (limit <= 0) return [];
  const selected: AtlasJourneySuggestion[] = [];
  const claimedEntries = new Set<string>();

  for (const suggestion of [...imports, ...historical]) {
    if (excludedKeys.has(suggestion.key)) continue;
    if (suggestion.entryIds.some((entryId) => claimedEntries.has(entryId))) {
      continue;
    }
    selected.push(suggestion);
    suggestion.entryIds.forEach((entryId) => claimedEntries.add(entryId));
    if (selected.length >= Math.max(0, limit)) break;
  }

  return selected;
}
