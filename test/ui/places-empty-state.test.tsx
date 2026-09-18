/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import CollectionPage from '@/app/dashboard/places/page';
import { getAtlasCollectionData } from '@/app/lib/atlas/data';

jest.mock('@/app/lib/atlas/data', () => ({
  getAtlasCollectionData: jest.fn(),
}));

jest.mock('@/components/atlas/keepsake-card', () => ({
  KeepsakeCard: ({ entry }: { entry: { title: string } }) => (
    <article>
      <h2>{entry.title}</h2>
    </article>
  ),
}));

const memory = {
  id: 'memory-1',
  title: 'A populated place',
  description: 'A memory that must survive empty-state simplification.',
  placeLabel: 'Detroit, Michigan',
  placeName: 'Detroit',
  placeLocality: 'Detroit',
  placeRegion: 'Michigan',
  placeCountry: 'United States',
  placeCountryCode: 'US',
  placeGeocoder: 'test',
  placeGeocodedAt: '2026-09-15T12:00:00.000Z',
  latitude: 42.3314,
  longitude: -83.0458,
  visitedOn: '2026-09-15',
  recordState: 'saved' as const,
  journeyState: 'visited' as const,
  version: 1,
  createdAt: '2026-09-15T12:00:00.000Z',
  updatedAt: '2026-09-15T12:00:00.000Z',
  media: [],
};

describe('Places empty-state disclosure', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows one focused action set and no zero-value controls when empty', async () => {
    jest.mocked(getAtlasCollectionData).mockResolvedValue({
      entries: [],
      counts: { total: 0, visited: 0, future: 0 },
      page: 1,
      pageSize: 24,
      offset: 0,
      totalPages: 1,
    });

    render(await CollectionPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole('heading', {
        name: 'Your collection is ready for its first place.',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Upload photos' })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole('navigation', { name: 'Filter saved places' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('saved places')).not.toBeInTheDocument();
  });

  it('keeps populated counts, filters, upload action, and cards intact', async () => {
    jest.mocked(getAtlasCollectionData).mockResolvedValue({
      entries: [memory],
      counts: { total: 1, visited: 1, future: 0 },
      page: 1,
      pageSize: 24,
      offset: 0,
      totalPages: 1,
    });

    render(await CollectionPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('saved places')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Filter saved places' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload photos' })).toHaveAttribute(
      'href',
      '/dashboard/import',
    );
    expect(
      screen.getByRole('heading', { name: 'A populated place' }),
    ).toBeInTheDocument();
  });

  it('keeps populated navigation when a filter has no matching places', async () => {
    jest.mocked(getAtlasCollectionData).mockResolvedValue({
      entries: [],
      counts: { total: 1, visited: 1, future: 0 },
      page: 1,
      pageSize: 24,
      offset: 0,
      totalPages: 1,
    });

    render(
      await CollectionPage({
        searchParams: Promise.resolve({ view: 'ahead' }),
      }),
    );

    expect(screen.getByText('saved places')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Filter saved places' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'No future places are waiting in the wings.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View all places' }),
    ).toHaveAttribute('href', '/dashboard/places');
  });
});
