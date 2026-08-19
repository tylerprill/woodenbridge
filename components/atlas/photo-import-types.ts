import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasImportSourceMimeType } from '@/app/lib/atlas/import-definitions';
import type { AtlasPlaceContext } from '@/app/lib/atlas/place';
import type {
  AnalyzedImportPhoto,
  PreparedImportPhoto,
} from '@/app/lib/atlas/photo-import-client';

export const MAX_IMPORT_PHOTOS = 50;
export const ACCEPTED_IMPORT_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
] as const;
export const ACCEPTED_IMPORT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

export const IMPORT_STEPS = [
  ['choose', 'Choose photos'],
  ['review', 'Review journey'],
  ['stories', 'Tell the stories'],
  ['chapter', 'Shape chapter'],
] as const;

export const IMPORT_DEFAULT_VIEW: AtlasView = {
  latitude: 22,
  longitude: -18,
  zoom: 1.65,
  bearing: 0,
  pitch: 0,
};

export type ImportStep = (typeof IMPORT_STEPS)[number][0] | 'complete';
export type LocationSource = 'photo_gps' | 'manual' | 'missing';
export type CaptureDateSource =
  'photo_metadata' | 'file_date' | 'manual' | 'missing';
export type ImportItemState =
  'analyzing' | 'locating' | 'ready' | 'needs-place' | 'duplicate' | 'error';
export type ImportUploadState =
  'waiting' | 'preparing' | 'uploading' | 'uploaded' | 'error';

export type ImportItem = {
  clientItemId: string;
  file: File;
  previewUrl: string;
  fileName: string;
  analysis: AnalyzedImportPhoto | null;
  /** Kept only while this item is being uploaded, then released. */
  prepared: PreparedImportPhoto | null;
  width: number | null;
  height: number | null;
  contentHash: string | null;
  latitude: number | null;
  longitude: number | null;
  place: AtlasPlaceContext | null;
  placeLabel: string;
  /** True only after the traveler edits the detected display label. */
  placeLabelEdited: boolean;
  visitedOn: string;
  capturedAt: string | null;
  locationSource: LocationSource;
  captureDateSource: CaptureDateSource;
  /** A filesystem timestamp is low-confidence until the traveler accepts it. */
  fileDateConfirmed: boolean;
  title: string;
  description: string;
  state: ImportItemState;
  error: string;
  uploadState: ImportUploadState;
};

export type BatchMapping = {
  clientItemId: string;
  itemId: string;
  entryId: string;
  mediaId: string;
};

export type ActiveBatch = {
  batchId: string;
  version: number;
  createChapter: boolean;
  coverClientItemId: string | null;
  items: BatchMapping[];
};

export type ImportCompletion = {
  entryIds: string[];
  chapterId: string | null;
};

export type UpdateImportItem = (
  id: string,
  update: Partial<ImportItem>,
) => void;

export type ConfirmImportLocation = (
  item: ImportItem,
  coordinates: { latitude: number; longitude: number },
) => Promise<void>;

export type ImportMapEntry = AtlasEntry;

export function sourceMimeType(
  analysis: AnalyzedImportPhoto,
): AtlasImportSourceMimeType {
  if (analysis.format === 'heic') {
    return analysis.declaredMimeType === 'image/heif'
      ? 'image/heif'
      : 'image/heic';
  }
  if (analysis.format === 'png') return 'image/png';
  if (analysis.format === 'webp') return 'image/webp';
  return 'image/jpeg';
}
