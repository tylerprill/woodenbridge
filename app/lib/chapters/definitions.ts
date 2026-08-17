import type {
  AtlasEntry,
  AtlasMedia,
  JourneyState,
} from '@/app/lib/atlas/definitions';

export const CHAPTER_VISIBILITIES = ['private', 'shared'] as const;
export type ChapterVisibility = (typeof CHAPTER_VISIBILITIES)[number];

export const CHAPTER_LOCATION_PRECISIONS = ['approximate', 'exact'] as const;
export type ChapterLocationPrecision =
  (typeof CHAPTER_LOCATION_PRECISIONS)[number];

export type AtlasChapterSummary = {
  id: string;
  title: string;
  introduction: string;
  version: number;
  memoryCount: number;
  startDate: string | null;
  endDate: string | null;
  coverMedia: AtlasMedia | null;
  coverMediaId: string | null;
  visibility: ChapterVisibility;
  shareId: string;
  shareMap: boolean;
  shareLocationPrecision: ChapterLocationPrecision;
  createdAt: string;
  updatedAt: string;
};

export type AtlasChapterEntry = AtlasEntry & {
  transitionNote: string;
};

export type AtlasChapter = AtlasChapterSummary & {
  entries: AtlasChapterEntry[];
};

export type AtlasChapterEditorChapter = Pick<
  AtlasChapter,
  | 'id'
  | 'title'
  | 'introduction'
  | 'version'
  | 'coverMediaId'
  | 'visibility'
  | 'shareId'
  | 'shareMap'
  | 'shareLocationPrecision'
> & {
  memories: AtlasChapterMemoryInput[];
};

export type AtlasChapterMemoryOption = {
  id: string;
  title: string;
  placeLabel: string;
  placeName: string | null;
  visitedOn: string | null;
  journeyState: JourneyState;
  coverMediaId: string | null;
  thumbnailUrl: string | null;
};

export type AtlasChapterEditorData = {
  chapter: AtlasChapterEditorChapter | null;
  availableEntries: AtlasChapterMemoryOption[];
};

export type AtlasChapterMemoryInput = {
  entryId: string;
  transitionNote: string;
};

export type AtlasChapterInput = {
  title: string;
  introduction: string;
  memories: AtlasChapterMemoryInput[];
  coverMediaId: string | null;
  visibility: ChapterVisibility;
  shareMap: boolean;
  shareLocationPrecision: ChapterLocationPrecision;
};

export type AtlasChapterUpdateInput = AtlasChapterInput & {
  id: string;
  version: number;
};

export type ChapterActionError =
  'invalid' | 'not-found' | 'conflict' | 'failed';

export type ChapterActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ChapterActionError; message: string };
