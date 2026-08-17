import { z } from 'zod';

import {
  CHAPTER_LOCATION_PRECISIONS,
  CHAPTER_VISIBILITIES,
} from './definitions';

export const CHAPTER_TITLE_MAX_LENGTH = 100;
export const CHAPTER_INTRODUCTION_MAX_LENGTH = 1200;
export const CHAPTER_TRANSITION_MAX_LENGTH = 500;
export const CHAPTER_MIN_MEMORIES = 2;
export const CHAPTER_MAX_MEMORIES = 50;

export const atlasChapterIdSchema = z.string().uuid();

const chapterMemoriesSchema = z
  .array(
    z.object({
      entryId: z.string().uuid(),
      transitionNote: z
        .string()
        .trim()
        .max(
          CHAPTER_TRANSITION_MAX_LENGTH,
          `Keep each transition under ${CHAPTER_TRANSITION_MAX_LENGTH} characters.`,
        ),
    }),
  )
  .min(
    CHAPTER_MIN_MEMORIES,
    `Choose at least ${CHAPTER_MIN_MEMORIES} memories for this chapter.`,
  )
  .max(
    CHAPTER_MAX_MEMORIES,
    `A chapter can hold up to ${CHAPTER_MAX_MEMORIES} memories.`,
  )
  .refine(
    (memories) =>
      new Set(memories.map((memory) => memory.entryId)).size ===
      memories.length,
    {
      message: 'Each memory can appear only once in a chapter.',
    },
  );

const atlasChapterInputFields = {
  title: z
    .string()
    .trim()
    .min(1, 'Give this chapter a title.')
    .max(
      CHAPTER_TITLE_MAX_LENGTH,
      `Keep the title under ${CHAPTER_TITLE_MAX_LENGTH} characters.`,
    ),
  introduction: z
    .string()
    .trim()
    .max(
      CHAPTER_INTRODUCTION_MAX_LENGTH,
      `Keep the introduction under ${CHAPTER_INTRODUCTION_MAX_LENGTH} characters.`,
    ),
  memories: chapterMemoriesSchema,
  coverMediaId: z.string().uuid().nullable(),
  visibility: z.enum(CHAPTER_VISIBILITIES),
  shareMap: z.boolean(),
  shareLocationPrecision: z.enum(CHAPTER_LOCATION_PRECISIONS),
} satisfies z.ZodRawShape;

function enforceEffectiveSharePrecision<
  T extends {
    shareMap: boolean;
    shareLocationPrecision: (typeof CHAPTER_LOCATION_PRECISIONS)[number];
  },
>(
  chapter: T,
): Omit<T, 'shareLocationPrecision'> & {
  shareLocationPrecision: (typeof CHAPTER_LOCATION_PRECISIONS)[number];
} {
  const shareLocationPrecision: (typeof CHAPTER_LOCATION_PRECISIONS)[number] =
    chapter.shareMap ? chapter.shareLocationPrecision : 'approximate';
  return { ...chapter, shareLocationPrecision };
}

export const atlasChapterInputSchema = z
  .object(atlasChapterInputFields)
  .transform(enforceEffectiveSharePrecision);

export const atlasChapterUpdateSchema = z
  .object({
    ...atlasChapterInputFields,
    id: atlasChapterIdSchema,
    version: z.number().int().positive(),
  })
  .transform(enforceEffectiveSharePrecision);
