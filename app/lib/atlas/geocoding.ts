import 'server-only';

import type { AtlasPlaceContext } from './place';

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_USER_AGENT =
  'FieldAtlas/1.0 (https://woodenbridge.vercel.app; place-enrichment)';

type NominatimResponse = {
  name?: unknown;
  display_name?: unknown;
  address?: Record<string, unknown>;
};

export type AtlasPlaceLookupResult =
  | { ok: true; data: AtlasPlaceContext }
  | {
      ok: false;
      reason: 'not-found' | 'provider-error' | 'rate-limited';
      retryAfterMs?: number;
    };

const DEFAULT_TRANSIENT_RETRY_MS = 1_500;
const MIN_TRANSIENT_RETRY_MS = 250;
const MAX_TRANSIENT_RETRY_MS = 10_000;

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstText(address: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(address[key]);
    if (value) return value;
  }
  return null;
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return DEFAULT_TRANSIENT_RETRY_MS;

  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : new Date(value).getTime() - Date.now();

  if (!Number.isFinite(milliseconds)) return DEFAULT_TRANSIENT_RETRY_MS;
  return Math.min(
    MAX_TRANSIENT_RETRY_MS,
    Math.max(MIN_TRANSIENT_RETRY_MS, Math.ceil(milliseconds)),
  );
}

function toPlaceContext(
  response: NominatimResponse,
): Omit<AtlasPlaceContext, 'geocodedAt'> | null {
  const address = response.address ?? {};
  const locality = firstText(address, [
    'city',
    'town',
    'village',
    'municipality',
    'hamlet',
    'suburb',
    'neighbourhood',
    'residential',
  ]);
  const region = firstText(address, ['state', 'province', 'region']);
  const country = text(address.country);
  const countryCode = text(address.country_code)?.toUpperCase() ?? null;
  // Nominatim's `name` is the nearest named feature. In cities the locality
  // still wins in our presentation formatter, while remote photographs keep
  // an honest trail, park, lake, or landmark instead of collapsing to a whole
  // state or country. We intentionally do not promote a county to `locality`:
  // a county is useful context, but it is not a city.
  const namedFeature = text(response.name);
  const placeName = namedFeature || locality || region || country;

  if (!placeName) return null;

  return {
    placeName,
    locality,
    region,
    country,
    countryCode,
    geocoder: 'nominatim',
  };
}

export async function lookupAtlasPlace({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): Promise<AtlasPlaceLookupResult> {
  const endpoint = process.env.ATLAS_GEOCODER_ENDPOINT || DEFAULT_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');
  url.searchParams.set('lat', latitude.toFixed(6));
  url.searchParams.set('lon', longitude.toFixed(6));
  url.searchParams.set('accept-language', 'en');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          process.env.ATLAS_GEOCODER_USER_AGENT || DEFAULT_USER_AGENT,
      },
      // The importer owns a durable, access-controlled coordinate cache. Do
      // not duplicate exact traveler coordinates in Next's fetch cache.
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });

    if (response.status === 429) {
      return {
        ok: false,
        reason: 'rate-limited',
        retryAfterMs: retryAfterMilliseconds(response),
      };
    }
    if (
      response.status === 408 ||
      response.status === 425 ||
      response.status >= 500
    ) {
      return {
        ok: false,
        reason: 'provider-error',
        retryAfterMs: retryAfterMilliseconds(response),
      };
    }
    if (!response.ok) return { ok: false, reason: 'provider-error' };
    const parsed = (await response.json()) as NominatimResponse;
    const context = toPlaceContext(parsed);
    if (!context) return { ok: false, reason: 'not-found' };

    return {
      ok: true,
      data: { ...context, geocodedAt: new Date().toISOString() },
    };
  } catch (error) {
    console.warn('Atlas place enrichment failed:', error);
    return {
      ok: false,
      reason: 'provider-error',
      retryAfterMs: DEFAULT_TRANSIENT_RETRY_MS,
    };
  }
}

export async function reverseGeocodeAtlasPlace(input: {
  latitude: number;
  longitude: number;
}): Promise<AtlasPlaceContext | null> {
  const result = await lookupAtlasPlace(input);
  return result.ok ? result.data : null;
}
