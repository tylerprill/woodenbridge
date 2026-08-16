import { z } from 'zod';

export const CHAPTER_TITLE_MAX_LENGTH = 100;
export const CHAPTER_INTRODUCTION_MAX_LENGTH = 1200;
export const CHAPTER_MIN_MEMORIES = 2;
export const CHAPTER_MAX_MEMORIES = 50;

export const atlasChapterIdSchema = z.string().uuid();

const chapterEntryIdsSchema = z
  .array(z.string().uuid())
  .min(
    CHAPTER_MIN_MEMORIES,
    `Choose at least ${CHAPTER_MIN_MEMORIES} memories for this chapter.`,
  )
  .max(
    CHAPTER_MAX_MEMORIES,
    `A chapter can hold up to ${CHAPTER_MAX_MEMORIES} memories.`,
  )
  .refine((entryIds) => new Set(entryIds).size === entryIds.length, {
    message: 'Each memory can appear only once in a chapter.',
  });

export const atlasChapterInputSchema = z.object({
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
  entryIds: chapterEntryIdsSchema,
});

export const atlasChapterUpdateSchema = atlasChapterInputSchema.extend({
  id: atlasChapterIdSchema,
  version: z.number().int().positive(),
});
