import { z } from 'zod';

import {
  CHAPTER_INTRODUCTION_MAX_LENGTH,
  CHAPTER_TITLE_MAX_LENGTH,
} from '@/app/lib/chapters/validation';
import {
  ATLAS_DESCRIPTION_MAX_LENGTH,
  ATLAS_PLACE_MAX_LENGTH,
  ATLAS_TITLE_MAX_LENGTH,
} from './validation';
import {
  ATLAS_IMPORT_DATE_SOURCES,
  ATLAS_IMPORT_LOCATION_SOURCES,
  ATLAS_IMPORT_SOURCE_MIME_TYPES,
} from './import-definitions';

export const ATLAS_IMPORT_MAX_ITEMS = 50;
export const ATLAS_IMPORT_MAX_ACTIVE_BATCHES = 3;
export const ATLAS_IMPORT_MAX_RETAINED_CLEANUP_BATCHES = 20;
export const ATLAS_IMPORT_MAX_ACCOUNT_ENTRIES = 5_000;
export const ATLAS_IMPORT_MAX_PIXELS = 25_000_000;
export const ATLAS_IMPORT_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
export const ATLAS_IMPORT_MAX_MEDIA_EDGE = 2_560;
export const ATLAS_IMPORT_MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const ATLAS_IMPORT_MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const ATLAS_IMPORT_CLEANUP_FENCE_MINUTES = 31;

const finiteNumber = z.number().finite();
const latitude = finiteNumber.min(-90).max(90);
const longitude = finiteNumber.min(-180).max(180);
const nullableTrimmedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);
const nullableDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(''), z.null()])
  .transform((value) => value || null);
const nullableTimestamp = z
  .union([z.string().datetime({ offset: true }), z.literal(''), z.null()])
  .transform((value) => value || null);

const dimensions = z
  .object({
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  })
  .refine(({ width, height }) => width * height <= ATLAS_IMPORT_MAX_PIXELS, {
    message: 'Each photograph must contain no more than 25 megapixels.',
  });
const pendingDimension = z
  .number()
  .int()
  .positive()
  .max(20_000)
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const pendingByteSize = (maximum: number) =>
  z
    .number()
    .int()
    .positive()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value ?? null);

export const reviewedAtlasImportItemSchema = z
  .object({
    clientItemId: z.string().uuid(),
    title: z.string().trim().min(1).max(ATLAS_TITLE_MAX_LENGTH),
    description: z.string().trim().max(ATLAS_DESCRIPTION_MAX_LENGTH),
    placeLabel: z.string().trim().max(ATLAS_PLACE_MAX_LENGTH),
    placeName: nullableTrimmedText(ATLAS_PLACE_MAX_LENGTH),
    placeLocality: nullableTrimmedText(ATLAS_PLACE_MAX_LENGTH),
    placeRegion: nullableTrimmedText(ATLAS_PLACE_MAX_LENGTH),
    placeCountry: nullableTrimmedText(ATLAS_PLACE_MAX_LENGTH),
    placeCountryCode: z
      .string()
      .trim()
      .max(2)
      .nullable()
      .transform((value) => value?.toUpperCase() || null)
      .refine((value) => value === null || /^[A-Z]{2}$/.test(value), {
        message: 'Use a two-letter country code.',
      }),
    placeGeocoder: nullableTrimmedText(32),
    placeGeocodedAt: nullableTimestamp,
    visitedOn: nullableDate,
    latitude,
    longitude,
    locationSource: z.enum(ATLAS_IMPORT_LOCATION_SOURCES),
    dateSource: z.enum(ATLAS_IMPORT_DATE_SOURCES),
    dateConfirmed: z.boolean(),
    sourceName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .transform((value) => value.split(/[\\/]/).at(-1) ?? value)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
        message: 'The photograph name is invalid.',
      }),
    sourceMimeType: z.enum(ATLAS_IMPORT_SOURCE_MIME_TYPES),
    sourceByteSize: z
      .number()
      .int()
      .positive()
      .max(ATLAS_IMPORT_MAX_SOURCE_BYTES),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceWidth: pendingDimension,
    sourceHeight: pendingDimension,
    mediaWidth: pendingDimension,
    mediaHeight: pendingDimension,
    preparedByteSize: pendingByteSize(ATLAS_IMPORT_MAX_MEDIA_BYTES),
    thumbnailByteSize: pendingByteSize(ATLAS_IMPORT_MAX_THUMBNAIL_BYTES),
  })
  .superRefine((item, context) => {
    const preparation = [
      item.sourceWidth,
      item.sourceHeight,
      item.mediaWidth,
      item.mediaHeight,
      item.preparedByteSize,
      item.thumbnailByteSize,
    ];
    const preparedValues = preparation.filter((value) => value !== null);
    if (
      preparedValues.length !== 0 &&
      preparedValues.length !== preparation.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Finish preparing the photograph before uploading it.',
      });
    }

    if (preparedValues.length === preparation.length) {
      for (const candidate of [
        { width: item.sourceWidth, height: item.sourceHeight },
        { width: item.mediaWidth, height: item.mediaHeight },
      ]) {
        const parsed = dimensions.safeParse(candidate);
        if (!parsed.success) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: parsed.error.issues[0]?.message ?? 'Invalid dimensions.',
          });
        }
      }
      if (
        item.mediaWidth !== null &&
        item.mediaHeight !== null &&
        Math.max(item.mediaWidth, item.mediaHeight) >
          ATLAS_IMPORT_MAX_MEDIA_EDGE
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The prepared photograph is too large.',
          path: ['mediaWidth'],
        });
      }
    }

    if (!item.placeLabel && !item.placeName) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name the place before importing it.',
        path: ['placeLabel'],
      });
    }

    if (item.dateSource === 'missing' && item.visitedOn !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A missing date cannot include a visit date.',
        path: ['visitedOn'],
      });
    }
    if (item.dateSource !== 'missing' && item.visitedOn === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Confirm the detected date before importing it.',
        path: ['visitedOn'],
      });
    }
    if (item.dateSource === 'file_date' && !item.dateConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Confirm the file date before importing it.',
        path: ['dateConfirmed'],
      });
    }

    if (Boolean(item.placeGeocoder) !== Boolean(item.placeGeocodedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The detected place is missing its source.',
        path: ['placeGeocoder'],
      });
    }
  })
  .transform((item) => ({
    ...item,
    placeSource:
      item.placeGeocoder && item.placeGeocodedAt
        ? ('geocoder' as const)
        : ('manual' as const),
  }));

export const createAtlasImportBatchSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    chapterTitle: z.string().trim().max(CHAPTER_TITLE_MAX_LENGTH),
    chapterIntroduction: z.string().trim().max(CHAPTER_INTRODUCTION_MAX_LENGTH),
    coverClientItemId: z.string().uuid().nullable(),
    items: z
      .array(reviewedAtlasImportItemSchema)
      .min(1, 'Choose at least one photograph.')
      .max(
        ATLAS_IMPORT_MAX_ITEMS,
        `Choose up to ${ATLAS_IMPORT_MAX_ITEMS} photographs at a time.`,
      ),
  })
  .superRefine(
    (
      { chapterTitle, chapterIntroduction, coverClientItemId, items },
      context,
    ) => {
      if (
        new Set(items.map((item) => item.clientItemId)).size !== items.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Each photograph needs a unique import identity.',
          path: ['items'],
        });
      }
      if (new Set(items.map((item) => item.sourceHash)).size !== items.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The same photograph was selected more than once.',
          path: ['items'],
        });
      }
      const chapterIntended = coverClientItemId !== null;
      if (chapterIntended) {
        if (items.length < 2) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Choose at least two photographs to create a chapter.',
            path: ['items'],
          });
        }
        if (!chapterTitle) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Name the chapter before creating it.',
            path: ['chapterTitle'],
          });
        }
        if (!items.some((item) => item.clientItemId === coverClientItemId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Choose a chapter cover from this photo import.',
            path: ['coverClientItemId'],
          });
        }
      } else if (chapterTitle || chapterIntroduction) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Choose a chapter cover before creating the chapter.',
          path: ['coverClientItemId'],
        });
      }
    },
  );

export const finalizeAtlasImportBatchSchema = z.object({
  batchId: z.string().uuid(),
  version: z.number().int().positive(),
  createChapter: z.boolean(),
  coverMediaId: z.string().uuid().nullable(),
});

export const prepareAtlasImportItemSchema = z
  .object({
    batchId: z.string().uuid(),
    itemId: z.string().uuid(),
    sourceWidth: z.number().int().positive().max(20_000),
    sourceHeight: z.number().int().positive().max(20_000),
    mediaWidth: z.number().int().positive().max(ATLAS_IMPORT_MAX_MEDIA_EDGE),
    mediaHeight: z.number().int().positive().max(ATLAS_IMPORT_MAX_MEDIA_EDGE),
    preparedByteSize: z
      .number()
      .int()
      .positive()
      .max(ATLAS_IMPORT_MAX_MEDIA_BYTES),
    thumbnailByteSize: z
      .number()
      .int()
      .positive()
      .max(ATLAS_IMPORT_MAX_THUMBNAIL_BYTES),
  })
  .superRefine((item, context) => {
    for (const candidate of [
      { width: item.sourceWidth, height: item.sourceHeight },
      { width: item.mediaWidth, height: item.mediaHeight },
    ]) {
      const parsed = dimensions.safeParse(candidate);
      if (!parsed.success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: parsed.error.issues[0]?.message ?? 'Invalid dimensions.',
        });
      }
    }
  });

export const cancelAtlasImportBatchSchema = z.object({
  batchId: z.string().uuid(),
  version: z.number().int().positive(),
});

export const atlasImportBatchIdSchema = z.string().uuid();

export const resolveAtlasImportPlaceSchema = z.object({
  latitude,
  longitude,
});
