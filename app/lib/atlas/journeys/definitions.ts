export const ATLAS_JOURNEY_SUGGESTION_SOURCES = [
  'photo_import',
  'atlas_history',
] as const;

export type AtlasJourneySuggestionSource =
  (typeof ATLAS_JOURNEY_SUGGESTION_SOURCES)[number];

export const ATLAS_JOURNEY_SUGGESTION_REASONS = [
  'imported_together',
  'nearby_dates_and_places',
] as const;

export type AtlasJourneySuggestionReason =
  (typeof ATLAS_JOURNEY_SUGGESTION_REASONS)[number];

export type AtlasJourneyStop = {
  entryId: string;
  position: number;
  title: string;
  placeLabel: string;
  placeName: string | null;
  visitedOn: string | null;
  latitude: number;
  longitude: number;
};

export type AtlasJourneySummary = {
  /** Uses the existing atlas_chapters id; Journey is the unified public name. */
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  startDate: string | null;
  endDate: string | null;
  memoryCount: number;
  drawable: boolean;
  stops: AtlasJourneyStop[];
};

export type AtlasJourneyDetailStop = AtlasJourneyStop & {
  description: string;
  transitionNote: string;
  thumbnailUrl: string | null;
  thumbnailAlt: string;
};

export type AtlasJourneyDetail = Omit<AtlasJourneySummary, 'stops'> & {
  introduction: string;
  stops: AtlasJourneyDetailStop[];
};

export type AtlasJourneySuggestion = {
  key: string;
  algorithmVersion: number;
  source: AtlasJourneySuggestionSource;
  reason: AtlasJourneySuggestionReason;
  explanation: string;
  suggestedTitle: string;
  startDate: string | null;
  endDate: string | null;
  memoryCount: number;
  entryIds: string[];
};

export type AtlasJourneyIndex = {
  journeys: AtlasJourneySummary[];
  suggestions: AtlasJourneySuggestion[];
};

export type AtlasJourneyListOptions = {
  search?: string;
  selectedJourneyId?: string | null;
  limit?: number;
  includeSuggestions?: boolean;
};

export type AtlasJourneyApiError = {
  error: 'unauthorized' | 'invalid' | 'not-found' | 'failed';
  message: string;
};
