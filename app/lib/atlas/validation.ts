import { z } from 'zod';

import { CHAPTER_SEGMENT_TITLE_MAX_LENGTH } from '@/app/lib/chapters/validation';
import { JOURNEY_STATES } from './definitions';

export const ATLAS_TITLE_MAX_LENGTH = 80;
export const ATLAS_DESCRIPTION_MAX_LENGTH = 1200;
export const ATLAS_PLACE_MAX_LENGTH = 120;

const finiteNumber = z.number().finite();
const latitude = finiteNumber.min(-90).max(90);
const longitude = finiteNumber.min(-180).max(180);

export const atlasDraftSchema = z.object({
  clientRequestId: z.string().uuid(),
  latitude,
  longitude,
});

export const atlasEntryUpdateSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    title: z
      .string()
      .trim()
      .min(1, 'Give this memory a title.')
      .max(ATLAS_TITLE_MAX_LENGTH),
    description: z.string().trim().max(ATLAS_DESCRIPTION_MAX_LENGTH),
    placeLabel: z.string().trim().max(ATLAS_PLACE_MAX_LENGTH),
    visitedOn: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
      .transform((value) => value || null),
    occurredTime: z
      .union([
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        z.literal(''),
        z.null(),
      ])
      .optional()
      .transform((value) => value || null),
    occurredUtcOffsetMinutes: z
      .number()
      .int()
      .min(-840)
      .max(840)
      .nullable()
      .optional()
      .transform((value) => value ?? null),
    journeyState: z.enum(JOURNEY_STATES),
    appendToJourneyId: z.string().uuid().optional(),
    appendToJourneySegmentId: z.string().uuid().optional(),
    appendToNewJourneySegmentTitle: z
      .string()
      .trim()
      .min(1, 'Give the new segment a title.')
      .max(
        CHAPTER_SEGMENT_TITLE_MAX_LENGTH,
        `Keep the segment title under ${CHAPTER_SEGMENT_TITLE_MAX_LENGTH} characters.`,
      )
      .optional(),
  })
  .superRefine((memory, context) => {
    if (memory.occurredTime && !memory.visitedOn) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['occurredTime'],
        message: 'Choose a date before adding a time.',
      });
    }
    if (memory.occurredUtcOffsetMinutes !== null && !memory.occurredTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['occurredUtcOffsetMinutes'],
        message: 'A photo timezone requires an occurrence time.',
      });
    }
    if (
      (memory.appendToJourneySegmentId ||
        memory.appendToNewJourneySegmentTitle) &&
      !memory.appendToJourneyId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appendToJourneyId'],
        message: 'Choose a journey before choosing one of its segments.',
      });
    }
    if (
      memory.appendToJourneySegmentId &&
      memory.appendToNewJourneySegmentTitle
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appendToJourneySegmentId'],
        message: 'Choose an existing segment or create a new one, not both.',
      });
    }
  });

export const atlasEntryIdSchema = z.string().uuid();

export const atlasViewSchema = z.object({
  latitude,
  longitude,
  zoom: finiteNumber.min(0).max(20),
  bearing: finiteNumber.min(-360).max(360),
  pitch: finiteNumber.min(0).max(70),
});
