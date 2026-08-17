/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { render, screen } from '@testing-library/react';

import type { SharedAtlasChapter } from '@/app/lib/chapters/definitions';
import { ChapterReader } from '@/components/chapters/chapter-reader';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    fetchPriority: _fetchPriority,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    unoptimized?: boolean;
    fetchPriority?: string;
  }) => <img alt={alt ?? ''} {...props} />,
}));

jest.mock('@/components/chapters/chapter-map-loader', () => ({
  ChapterMapLoader: () => <div data-testid="chapter-map">Chapter map</div>,
}));

const chapter: SharedAtlasChapter = {
  id: 'chapter-1',
  title: 'Wonders without borders',
  introduction:
    'Ten places across the world, held together as one remembered journey.',
  version: 1,
  memoryCount: 1,
  startDate: '2026-01-03',
  endDate: '2026-01-03',
  coverMedia: null,
  coverMediaId: null,
  visibility: 'shared',
  shareId: 'share-1',
  shareMap: true,
  shareLocationPrecision: 'approximate',
  createdAt: '2026-01-04T00:00:00.000Z',
  updatedAt: '2026-01-04T00:00:00.000Z',
  entries: [
    {
      id: 'memory-1',
      title: 'Petra at dawn',
      description: 'The rose city appeared slowly as the canyon opened.',
      placeLabel: 'Petra, Jordan',
      placeName: 'Petra',
      placeLocality: 'Petra',
      placeRegion: null,
      placeCountry: 'Jordan',
      placeCountryCode: 'JO',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-01-03T00:00:00.000Z',
      visitedOn: '2026-01-03',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 30.3,
      longitude: 35.4,
      version: 1,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      media: [],
      transitionNote: '',
    },
  ],
};

describe('shared Chapter reader', () => {
  it('presents an editorial public journey without exposing private keepsakes', () => {
    render(<ChapterReader chapter={chapter} mode="shared" />);

    expect(
      screen.getByRole('button', { name: 'Share chapter' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start your atlas' }),
    ).toHaveAttribute('href', '/sign-up');
    expect(
      screen.getByRole('link', { name: /Begin the journey/i }),
    ).toHaveAttribute('href', '#chapter-story');
    expect(
      screen.getByRole('region', { name: 'Chapter introduction' }),
    ).toHaveTextContent('Ten places across the world');
    expect(
      screen.getByRole('heading', { name: 'The route, remembered.' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your route, remembered.' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('#chapter-route')).not.toBeNull();
    expect(document.querySelector('#chapter-memories')).not.toBeNull();
    expect(screen.getByTestId('chapter-map')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start your own atlas' }),
    ).toHaveAttribute('href', '/sign-up');
    expect(
      screen.getByRole('link', { name: 'Back to the beginning' }),
    ).toHaveAttribute('href', '#chapter-top');
    expect(
      screen.queryByRole('link', { name: /Open Petra at dawn keepsake/i }),
    ).not.toBeInTheDocument();
  });
});
