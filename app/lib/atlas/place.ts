import type { AtlasEntry } from './definitions';

export type AtlasPlaceContext = {
  placeName: string;
  locality: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  geocoder: string;
  geocodedAt: string;
};

type AtlasPlaceFields = Pick<
  AtlasEntry,
  'placeLabel' | 'placeName' | 'placeLocality' | 'placeRegion' | 'placeCountry'
>;

function uniqueParts(parts: Array<string | null | undefined>) {
  return parts.filter(
    (part, index, all): part is string =>
      Boolean(part?.trim()) &&
      all.findIndex((candidate) => candidate?.trim() === part?.trim()) ===
        index,
  );
}

function distinctPair(first: string | null, second: string | null) {
  if (!first || !second || first.toLowerCase() === second.toLowerCase()) {
    return null;
  }
  return `${first}, ${second}`;
}

export function getAtlasPlaceLabel(entry: AtlasPlaceFields) {
  return (
    entry.placeLabel.trim() ||
    entry.placeName?.trim() ||
    uniqueParts([entry.placeLocality, entry.placeRegion])[0] ||
    'Place awaiting detail'
  );
}

export function getAtlasPlaceContextLabel(entry: AtlasPlaceFields) {
  const customLabel = entry.placeLabel.trim();
  if (customLabel) return customLabel;

  const locality = entry.placeLocality?.trim() || null;
  const region = entry.placeRegion?.trim() || null;
  const country = entry.placeCountry?.trim() || null;
  const placeName = entry.placeName?.trim() || null;

  const localityRegion = distinctPair(locality, region);
  if (localityRegion) return localityRegion;

  const localityCountry = distinctPair(locality, country);
  if (localityCountry) return localityCountry;

  const placeNameRegion = distinctPair(placeName, region);
  if (placeNameRegion) return placeNameRegion;

  const placeNameCountry = distinctPair(placeName, country);
  if (placeNameCountry) return placeNameCountry;

  const parts = uniqueParts([locality, placeName, region, country]);
  return parts.join(', ') || 'Place awaiting detail';
}

export function getAtlasPlaceInputLabel(entry: AtlasPlaceFields) {
  const storedLabel = entry.placeLabel.trim();
  const detectedLabel = getAtlasPlaceContextLabel({
    ...entry,
    placeLabel: '',
  });

  if (!storedLabel) return detectedLabel;

  const normalizedStoredLabel = storedLabel.toLocaleLowerCase();
  const isRecognizedFragment = [
    entry.placeName,
    entry.placeLocality,
    entry.placeRegion,
    entry.placeCountry,
  ].some((part) => part?.trim().toLocaleLowerCase() === normalizedStoredLabel);

  return isRecognizedFragment ? detectedLabel : storedLabel;
}

export function formatAtlasDate(
  entry: Pick<AtlasEntry, 'visitedOn' | 'journeyState'>,
) {
  if (!entry.visitedOn) {
    return entry.journeyState === 'visited' ? 'Date not set' : 'No date set';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${entry.visitedOn}T12:00:00`));
}
