import { z } from 'zod';

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

export const atlasEntryUpdateSchema = z.object({
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
  journeyState: z.enum(JOURNEY_STATES),
});

export const atlasEntryIdSchema = z.string().uuid();

export const atlasViewSchema = z.object({
  latitude,
  longitude,
  zoom: finiteNumber.min(0).max(20),
  bearing: finiteNumber.min(-360).max(360),
  pitch: finiteNumber.min(0).max(70),
});
