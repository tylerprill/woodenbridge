import 'server-only';

import type {
  AtlasEntry,
  AtlasMedia,
  AtlasRecordState,
  AtlasView,
  JourneyState,
} from './definitions';

export type AtlasEntryRow = {
  id: string;
  title: string;
  description: string;
  place_label: string | null;
  visited_on: Date | string | null;
  record_state: AtlasRecordState;
  journey_state: JourneyState;
  latitude: number | string;
  longitude: number | string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

export type AtlasViewRow = {
  latitude: number | string;
  longitude: number | string;
  zoom: number | string;
  bearing: number | string;
  pitch: number | string;
};

export type AtlasMediaRow = {
  id: string;
  entry_id: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  byte_size: number;
  alt_text: string | null;
  sort_order: number;
  created_at: Date | string;
};

function toDateString(value: Date | string | null) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export function toAtlasEntry(
  row: AtlasEntryRow,
  media: AtlasMedia[] = [],
): AtlasEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    placeLabel: row.place_label ?? '',
    visitedOn: toDateString(row.visited_on),
    recordState: row.record_state,
    journeyState: row.journey_state,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    version: row.version,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    media,
  };
}

export function toAtlasMedia(row: AtlasMediaRow): AtlasMedia {
  return {
    id: row.id,
    entryId: row.entry_id,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    altText: row.alt_text ?? '',
    sortOrder: row.sort_order,
    createdAt: toIsoString(row.created_at),
    deliveryUrl: `/api/atlas/media/${row.id}`,
  };
}

export const DEFAULT_ATLAS_VIEW: AtlasView = {
  latitude: 22,
  longitude: -18,
  zoom: 1.65,
  bearing: 0,
  pitch: 0,
};

export function toAtlasView(row?: AtlasViewRow): AtlasView {
  if (!row) return DEFAULT_ATLAS_VIEW;

  return {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    zoom: Number(row.zoom),
    bearing: Number(row.bearing),
    pitch: Number(row.pitch),
  };
}
