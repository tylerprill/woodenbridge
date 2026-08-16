jest.mock('server-only', () => ({}));

import { reverseGeocodeAtlasPlace } from '@/app/lib/atlas/geocoding';

describe('reverseGeocodeAtlasPlace', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('keeps a concise locality and region from a reverse-geocoder response', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: '',
          address: {
            residential: 'Country Cottage Estates',
            county: 'Genesee County',
            state: 'Michigan',
            country: 'United States',
            country_code: 'us',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      reverseGeocodeAtlasPlace({ latitude: 42.88454, longitude: -83.65676 }),
    ).resolves.toMatchObject({
      placeName: 'Country Cottage Estates',
      locality: 'Country Cottage Estates',
      region: 'Michigan',
      country: 'United States',
      countryCode: 'US',
      geocoder: 'nominatim',
    });
  });

  it('returns null when the provider is unavailable', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      reverseGeocodeAtlasPlace({ latitude: 42, longitude: -83 }),
    ).resolves.toBeNull();
  });

  it('does not treat a county as a state or province', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: '',
          address: {
            city: 'Kyoto',
            county: 'Kyoto District',
            country: 'Japan',
            country_code: 'jp',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      reverseGeocodeAtlasPlace({ latitude: 35.0116, longitude: 135.7681 }),
    ).resolves.toMatchObject({
      placeName: 'Kyoto',
      locality: 'Kyoto',
      region: null,
      country: 'Japan',
      countryCode: 'JP',
    });
  });
});
