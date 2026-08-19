import type { AtlasPlaceContext } from './place';

export const ATLAS_IMPORT_STATUSES = [
  'uploading',
  'ready',
  'completed',
  'cancel_pending',
  'cancelled',
] as const;
export type AtlasImportStatus = (typeof ATLAS_IMPORT_STATUSES)[number];

export const ATLAS_IMPORT_ITEM_STATUSES = ['pending', 'uploaded'] as const;
export type AtlasImportItemStatus = (typeof ATLAS_IMPORT_ITEM_STATUSES)[number];

export const ATLAS_IMPORT_SOURCE_MIME_TYPES = [
  'image/heic',
  'image/heif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type AtlasImportSourceMimeType =
  (typeof ATLAS_IMPORT_SOURCE_MIME_TYPES)[number];

export const ATLAS_IMPORT_LOCATION_SOURCES = ['photo_gps', 'manual'] as const;
export type AtlasImportLocationSource =
  (typeof ATLAS_IMPORT_LOCATION_SOURCES)[number];

export const ATLAS_IMPORT_DATE_SOURCES = [
  'photo_metadata',
  'file_date',
  'manual',
  'missing',
] as const;
export type AtlasImportDateSource = (typeof ATLAS_IMPORT_DATE_SOURCES)[number];

export const ATLAS_IMPORT_PLACE_SOURCES = ['geocoder', 'manual'] as const;
export type AtlasImportPlaceSource =
  (typeof ATLAS_IMPORT_PLACE_SOURCES)[number];

export type ReviewedAtlasImportItemInput = {
  clientItemId: string;
  title: string;
  description: string;
  placeLabel: string;
  placeName: string | null;
  placeLocality: string | null;
  placeRegion: string | null;
  placeCountry: string | null;
  placeCountryCode: string | null;
  placeGeocoder: string | null;
  placeGeocodedAt: string | null;
  visitedOn: string | null;
  latitude: number;
  longitude: number;
  locationSource: AtlasImportLocationSource;
  dateSource: AtlasImportDateSource;
  dateConfirmed: boolean;
  sourceName: string;
  sourceMimeType: AtlasImportSourceMimeType;
  sourceByteSize: number;
  sourceHash: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  preparedByteSize: number | null;
  thumbnailByteSize: number | null;
};

export type CreateAtlasImportBatchInput = {
  clientRequestId: string;
  chapterTitle: string;
  chapterIntroduction: string;
  coverClientItemId: string | null;
  items: ReviewedAtlasImportItemInput[];
};

export type FinalizeAtlasImportBatchInput = {
  batchId: string;
  version: number;
  createChapter: boolean;
  coverMediaId: string | null;
};

export type PrepareAtlasImportItemInput = {
  batchId: string;
  itemId: string;
  sourceWidth: number;
  sourceHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  preparedByteSize: number;
  thumbnailByteSize: number;
};

export type CancelAtlasImportBatchInput = {
  batchId: string;
  version: number;
};

export type ResolveAtlasImportPlaceInput = {
  latitude: number;
  longitude: number;
};

export type AtlasImportItem = ReviewedAtlasImportItemInput & {
  id: string;
  entryId: string;
  mediaId: string;
  position: number;
  status: AtlasImportItemStatus;
  placeSource: AtlasImportPlaceSource;
  pathname: string;
  thumbnailPathname: string;
  thumbnailUrl: string | null;
  uploadedAt: string | null;
};

export type AtlasImportBatch = {
  id: string;
  clientRequestId: string;
  status: AtlasImportStatus;
  version: number;
  chapterTitle: string;
  chapterIntroduction: string;
  coverClientItemId: string | null;
  items: AtlasImportItem[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AtlasImportDuplicate = {
  clientItemId: string;
  entryId: string;
  title: string;
};

export type AtlasImportFinalization = {
  batchId: string;
  version: number;
  entryIds: string[];
  chapterId: string | null;
  shareId: string | null;
};

export type AtlasImportPreparation = {
  batchId: string;
  itemId: string;
  prepared: true;
};

export type AtlasImportCancellation = {
  batchId: string;
  cleanupPending: boolean;
};

export type AtlasImportActionError =
  | 'invalid'
  | 'not-found'
  | 'conflict'
  | 'limit'
  | 'provider'
  | 'duplicate'
  | 'failed';

export type AtlasImportActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: AtlasImportActionError;
      message: string;
      duplicates?: AtlasImportDuplicate[];
      retryAfterMs?: number;
    };

export type AtlasImportPlaceResult = AtlasImportActionResult<AtlasPlaceContext>;
