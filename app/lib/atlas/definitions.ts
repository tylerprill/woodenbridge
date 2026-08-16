export const JOURNEY_STATES = ['visited', 'want_to_visit'] as const;
export type JourneyState = (typeof JOURNEY_STATES)[number];

export const ATLAS_RECORD_STATES = ['draft', 'saved'] as const;
export type AtlasRecordState = (typeof ATLAS_RECORD_STATES)[number];

export type AtlasEntry = {
  id: string;
  title: string;
  description: string;
  placeLabel: string;
  placeName: string | null;
  placeLocality: string | null;
  placeRegion: string | null;
  placeCountry: string | null;
  placeCountryCode: string | null;
  placeGeocoder: string | null;
  placeGeocodedAt: string | null;
  visitedOn: string | null;
  recordState: AtlasRecordState;
  journeyState: JourneyState;
  latitude: number;
  longitude: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  media: AtlasMedia[];
};

export type AtlasMedia = {
  id: string;
  entryId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  byteSize: number;
  altText: string;
  sortOrder: number;
  createdAt: string;
  deliveryUrl: string;
};

export type AtlasView = {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
};

export type AtlasData = {
  entries: AtlasEntry[];
  view: AtlasView;
};

export type AtlasActionError = 'invalid' | 'not-found' | 'conflict' | 'failed';

export type AtlasActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AtlasActionError; message: string };

export type AtlasDraftInput = {
  clientRequestId: string;
  latitude: number;
  longitude: number;
};

export type AtlasEntryUpdateInput = {
  id: string;
  version: number;
  title: string;
  description: string;
  placeLabel: string;
  visitedOn: string | null;
  journeyState: JourneyState;
};

export type AtlasViewInput = AtlasView;

export type AtlasMediaRegistrationInput = {
  entryId: string;
  pathname: string;
  width: number;
  height: number;
  altText: string;
};
