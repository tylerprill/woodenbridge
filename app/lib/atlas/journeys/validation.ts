import { z } from 'zod';

export const ATLAS_JOURNEY_DEFAULT_LIMIT = 50;
export const ATLAS_JOURNEY_MAX_LIMIT = 100;
export const ATLAS_JOURNEY_SEARCH_MAX_LENGTH = 120;
export const ATLAS_JOURNEY_SUGGESTION_KEY_LENGTH = 64;

export const atlasJourneyIdSchema = z.string().uuid();

export const atlasJourneySuggestionKeySchema = z
  .string()
  .length(ATLAS_JOURNEY_SUGGESTION_KEY_LENGTH)
  .regex(/^[0-9a-f]+$/);

export const atlasJourneyListOptionsSchema = z.object({
  search: z
    .string()
    .trim()
    .max(ATLAS_JOURNEY_SEARCH_MAX_LENGTH)
    .optional()
    .transform((value) => value || undefined),
  selectedJourneyId: atlasJourneyIdSchema.nullable().optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(ATLAS_JOURNEY_MAX_LIMIT)
    .default(ATLAS_JOURNEY_DEFAULT_LIMIT),
  includeSuggestions: z.boolean().default(false),
});
