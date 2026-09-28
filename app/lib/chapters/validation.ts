import { z } from 'zod';

import {
  CHAPTER_LOCATION_PRECISIONS,
  CHAPTER_VISIBILITIES,
} from './definitions';
import { ATLAS_JOURNEY_SUGGESTION_SOURCES } from '@/app/lib/atlas/journeys/definitions';

export const CHAPTER_TITLE_MAX_LENGTH = 100;
export const CHAPTER_INTRODUCTION_MAX_LENGTH = 1200;
export const CHAPTER_TRANSITION_MAX_LENGTH = 500;
export const CHAPTER_SEGMENT_TITLE_MAX_LENGTH = 100;
export const CHAPTER_MIN_MEMORIES = 2;
export const CHAPTER_MAX_MEMORIES = 50;
export const CHAPTER_MAX_SEGMENTS = CHAPTER_MAX_MEMORIES;

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
      segmentId: z.string().uuid().nullable().optional(),
    }),
  )
  .min(
    CHAPTER_MIN_MEMORIES,
    `Choose at least ${CHAPTER_MIN_MEMORIES} memories for this journey.`,
  )
  .max(
    CHAPTER_MAX_MEMORIES,
    `A journey can hold up to ${CHAPTER_MAX_MEMORIES} memories.`,
  )
  .refine(
    (memories) =>
      new Set(memories.map((memory) => memory.entryId)).size ===
      memories.length,
    {
      message: 'Each memory can appear only once in a journey.',
    },
  );

const journeySegmentsSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      title: z
        .string()
        .trim()
        .min(1, 'Give each segment a name.')
        .max(
          CHAPTER_SEGMENT_TITLE_MAX_LENGTH,
          `Keep each segment name under ${CHAPTER_SEGMENT_TITLE_MAX_LENGTH} characters.`,
        ),
    }),
  )
  .max(
    CHAPTER_MAX_SEGMENTS,
    `A journey can hold up to ${CHAPTER_MAX_SEGMENTS} segments.`,
  )
  .refine(
    (segments) =>
      new Set(segments.map((segment) => segment.id)).size === segments.length,
    { message: 'Each segment can appear only once in a journey.' },
  );

const atlasChapterInputFields = {
  title: z
    .string()
    .trim()
    .min(1, 'Give this journey a title.')
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
  .object({
    clientRequestId: z.string().uuid().optional(),
    journeySuggestion: z
      .object({
        key: z.string().regex(/^[0-9a-f]{64}$/),
        source: z.enum(ATLAS_JOURNEY_SUGGESTION_SOURCES),
      })
      .optional(),
    ...atlasChapterInputFields,
  })
  .transform(enforceEffectiveSharePrecision);

export const atlasChapterUpdateSchema = z
  .object({
    ...atlasChapterInputFields,
    id: atlasChapterIdSchema,
    version: z.number().int().positive(),
    segments: journeySegmentsSchema.optional(),
  })
  .superRefine((chapter, context) => {
    if (!chapter.segments) return;
    const segmentIds = new Set(chapter.segments.map((segment) => segment.id));
    for (const memory of chapter.memories) {
      if (memory.segmentId && !segmentIds.has(memory.segmentId)) {
        context.addIssue({
          code: 'custom',
          message: 'Every assigned segment must be included in the journey.',
          path: ['memories'],
        });
        return;
      }
    }
  })
  .transform(enforceEffectiveSharePrecision);

export const atlasChapterDeleteSchema = z.object({
  id: atlasChapterIdSchema,
  version: z.number().int().positive(),
});
