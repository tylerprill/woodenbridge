import type {
  AtlasEntry,
  AtlasMedia,
  JourneyState,
} from '@/app/lib/atlas/definitions';

export type AtlasChapterSummary = {
  id: string;
  title: string;
  introduction: string;
  version: number;
  memoryCount: number;
  startDate: string | null;
  endDate: string | null;
  coverMedia: AtlasMedia | null;
  createdAt: string;
  updatedAt: string;
};

export type AtlasChapter = AtlasChapterSummary & {
  entries: AtlasEntry[];
};

export type AtlasChapterEditorChapter = Pick<
  AtlasChapter,
  'id' | 'title' | 'introduction' | 'version'
> & {
  entryIds: string[];
};

export type AtlasChapterMemoryOption = {
  id: string;
  title: string;
  placeLabel: string;
  placeName: string | null;
  visitedOn: string | null;
  journeyState: JourneyState;
  thumbnailUrl: string | null;
};

export type AtlasChapterEditorData = {
  chapter: AtlasChapterEditorChapter | null;
  availableEntries: AtlasChapterMemoryOption[];
};

export type AtlasChapterInput = {
  title: string;
  introduction: string;
  entryIds: string[];
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
