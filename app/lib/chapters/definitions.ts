import type { AtlasEntry, AtlasMedia } from '@/app/lib/atlas/definitions';

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

export type AtlasChapterEditorData = {
  chapter: AtlasChapter | null;
  availableEntries: AtlasEntry[];
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
  | 'invalid'
  | 'not-found'
  | 'conflict'
  | 'failed';

export type ChapterActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ChapterActionError; message: string };
