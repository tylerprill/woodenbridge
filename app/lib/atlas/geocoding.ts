import 'server-only';

import type { AtlasPlaceContext } from './place';

const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const DEFAULT_USER_AGENT =
  'FieldAtlas/1.0 (https://woodenbridge.vercel.app; place-enrichment)';

type NominatimResponse = {
  name?: unknown;
  address?: Record<string, unknown>;
};

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
  const namedFeature = firstText(address, [
    'attraction',
    'tourism',
    'amenity',
    'historic',
    'natural',
    'leisure',
    'building',
  ])
    ? text(response.name)
    : null;
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

export async function reverseGeocodeAtlasPlace({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): Promise<AtlasPlaceContext | null> {
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
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) return null;
    const parsed = (await response.json()) as NominatimResponse;
    const context = toPlaceContext(parsed);
    if (!context) return null;

    return { ...context, geocodedAt: new Date().toISOString() };
  } catch (error) {
    console.warn('Atlas place enrichment failed:', error);
    return null;
  }
}
