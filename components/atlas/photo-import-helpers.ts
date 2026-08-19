import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import type { AtlasPlaceContext } from '@/app/lib/atlas/place';
import { getAtlasPlaceContextLabel } from '@/app/lib/atlas/place';
import { ATLAS_IMPORT_PHOTO_LIMITS } from '@/app/lib/atlas/photo-import-client';
import type { AnalyzedImportPhoto } from '@/app/lib/atlas/photo-import-client';
import {
  ACCEPTED_IMPORT_EXTENSIONS,
  ACCEPTED_IMPORT_MIME_TYPES,
  IMPORT_STEPS,
  type CaptureDateSource,
  type ImportItem,
  type ImportStep,
} from './photo-import-types';

type UnknownRecord = Record<string, unknown>;

export function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

export function textValue(...values: unknown[]) {
  const value = values.find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  );
  return typeof value === 'string' ? value.trim() : null;
}

export function unwrapAction<T>(result: unknown): T {
  const value = record(result);
  if ('ok' in value) {
    if (value.ok === true) return value.data as T;
    const error = new Error(
      textValue(value.message) ?? 'Field Atlas could not finish that request.',
    ) as Error & { code?: string; duplicates?: unknown };
    error.code = textValue(value.error) ?? undefined;
    error.duplicates = value.duplicates;
    throw error;
  }
  return result as T;
}

export function dateOnly(value: string | number | null) {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function formatImportDate(value: string) {
  if (!value) return 'Date needs review';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function fileExtension(file: File) {
  return file.name.split('.').at(-1)?.toLowerCase() ?? '';
}

export function getImportFileProblem(file: File) {
  if (
    !ACCEPTED_IMPORT_MIME_TYPES.has(file.type.toLowerCase()) &&
    !ACCEPTED_IMPORT_EXTENSIONS.includes(
      fileExtension(file) as (typeof ACCEPTED_IMPORT_EXTENSIONS)[number],
    )
  ) {
    return 'Choose a JPG, PNG, WebP, HEIC, or HEIF photograph.';
  }
  if (!file.size || file.size > ATLAS_IMPORT_PHOTO_LIMITS.sourceMaxBytes) {
    return 'Choose a photograph smaller than 25 MB.';
  }
  return null;
}

export function normalizeImportPlace(result: unknown): AtlasPlaceContext {
  const value = record(result);
  return {
    placeName: textValue(value.placeName) ?? 'Recognized place',
    locality: textValue(value.locality),
    region: textValue(value.region),
    country: textValue(value.country),
    countryCode: textValue(value.countryCode),
    geocoder: textValue(value.geocoder) ?? 'atlas',
    geocodedAt: textValue(value.geocodedAt) ?? new Date().toISOString(),
  };
}

export function getImportPlaceLabel(place: AtlasPlaceContext) {
  return getAtlasPlaceContextLabel({
    placeLabel: '',
    placeName: place.placeName,
    placeLocality: place.locality,
    placeRegion: place.region,
    placeCountry: place.country,
  });
}

export function getImportStepIndex(step: ImportStep, includeChapter: boolean) {
  if (step === 'complete') return includeChapter ? 4 : 3;
  const index = IMPORT_STEPS.findIndex(([value]) => value === step);
  return includeChapter || index < 3 ? index : 2;
}

export function getImportStatusCopy(item: ImportItem) {
  if (item.state === 'analyzing') return 'Reading photo details';
  if (item.state === 'locating') return 'Finding city and region';
  if (item.state === 'duplicate') return 'Already in this selection';
  if (item.state === 'error') return 'Could not read this photograph';
  if (item.latitude === null || item.longitude === null) return 'Place needed';
  if (item.locationSource === 'manual') return 'Pin placed by you';
  const location = item.analysis?.location;
  if (!location) return 'Location ready';
  if (location.confidence === 'high') {
    return location.accuracyMeters
      ? `Photo GPS · about ${Math.max(1, Math.round(location.accuracyMeters))} m accuracy`
      : 'Photo GPS · high confidence';
  }
  return `Photo GPS · ${location.confidence} confidence`;
}

export function needsFileDateConfirmation(
  item: Pick<
    ImportItem,
    'captureDateSource' | 'fileDateConfirmed' | 'visitedOn'
  >,
) {
  return (
    item.captureDateSource === 'file_date' &&
    Boolean(item.visitedOn) &&
    !item.fileDateConfirmed
  );
}

export function toImportMapEntry(
  item: ImportItem,
  index: number,
): AtlasEntry | null {
  if (item.latitude === null || item.longitude === null) return null;
  const now = new Date().toISOString();
  return {
    id: item.clientItemId,
    title: item.title || item.placeLabel || `Memory ${index + 1}`,
    description: item.description,
    placeLabel: item.placeLabel,
    placeName: item.place?.placeName ?? null,
    placeLocality: item.place?.locality ?? null,
    placeRegion: item.place?.region ?? null,
    placeCountry: item.place?.country ?? null,
    placeCountryCode: item.place?.countryCode ?? null,
    placeGeocoder: item.place?.geocoder ?? null,
    placeGeocodedAt: item.place?.geocodedAt ?? null,
    latitude: item.latitude,
    longitude: item.longitude,
    visitedOn: item.visitedOn || null,
    recordState: 'saved',
    journeyState: 'visited',
    version: 1,
    media: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function sortImportItems(first: ImportItem, second: ImportItem) {
  const firstDate = first.capturedAt || first.visitedOn;
  const secondDate = second.capturedAt || second.visitedOn;
  if (!firstDate && !secondDate) return 0;
  if (!firstDate) return 1;
  if (!secondDate) return -1;
  return firstDate.localeCompare(secondDate);
}

export function formatImportSize(bytes: number) {
  const megabytes = bytes >= 1024 * 1024;
  return new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit: megabytes ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(bytes / (megabytes ? 1024 * 1024 : 1024));
}

export function createAnalyzingImportItem(
  file: File,
  clientItemId: string,
  previewUrl: string,
): ImportItem {
  return {
    clientItemId,
    file,
    previewUrl,
    fileName: file.name,
    analysis: null,
    prepared: null,
    width: null,
    height: null,
    contentHash: null,
    latitude: null,
    longitude: null,
    place: null,
    placeLabel: '',
    placeLabelEdited: false,
    visitedOn: dateOnly(file.lastModified),
    capturedAt: null,
    locationSource: 'missing',
    captureDateSource: file.lastModified ? 'file_date' : 'missing',
    fileDateConfirmed: false,
    title: '',
    description: '',
    state: 'analyzing',
    error: '',
    uploadState: 'waiting',
  };
}

export function applyImportAnalysis(
  item: ImportItem,
  analysis: AnalyzedImportPhoto,
): ImportItem {
  const latitude = analysis.location?.latitude ?? null;
  const longitude = analysis.location?.longitude ?? null;
  const capturedAt =
    analysis.capture?.instant ?? analysis.capture?.localDateTime ?? null;
  const visitedOn =
    analysis.capture?.localDate ?? dateOnly(item.file.lastModified);
  const hasGps = latitude !== null && longitude !== null;
  const blockingIssue = analysis.issues.find(
    (issue) => issue.severity === 'error',
  );
  const captureDateSource: CaptureDateSource = analysis.capture
    ? analysis.capture.source === 'file-last-modified'
      ? 'file_date'
      : 'photo_metadata'
    : visitedOn
      ? 'file_date'
      : 'missing';
  return {
    ...item,
    analysis,
    contentHash: analysis.sourceHash,
    latitude,
    longitude,
    visitedOn,
    capturedAt,
    locationSource: hasGps ? 'photo_gps' : 'missing',
    captureDateSource,
    fileDateConfirmed: captureDateSource !== 'file_date',
    state: blockingIssue ? 'error' : hasGps ? 'locating' : 'needs-place',
    error: blockingIssue?.message ?? '',
  };
}
