/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AtlasEntryPresentation } from '@/app/lib/atlas/definitions';
import { MemoryArtwork } from '@/components/atlas/memory-artwork';

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

const baseEntry: AtlasEntryPresentation = {
  id: 'memory-1',
  title: 'Stone Against the Desert',
  description: 'A morning at Giza.',
  placeLabel: 'Giza, Egypt',
  placeName: 'Giza',
  placeLocality: 'Giza',
  placeRegion: null,
  placeCountry: 'Egypt',
  placeCountryCode: 'EG',
  placeGeocoder: 'test',
  placeGeocodedAt: '2026-01-03T00:00:00.000Z',
  visitedOn: '2026-01-03',
  recordState: 'saved',
  journeyState: 'visited',
  version: 1,
  createdAt: '2026-01-03T00:00:00.000Z',
  updatedAt: '2026-01-03T00:00:00.000Z',
  media: [],
};

function media(id: string, sortOrder: number) {
  return {
    id,
    entryId: baseEntry.id,
    mimeType: 'image/webp',
    width: 1200,
    height: 800,
    byteSize: 20_000,
    altText: `Giza view ${sortOrder + 1}`,
    sortOrder,
    createdAt: '2026-01-03T00:00:00.000Z',
    deliveryUrl: `/media/${id}.webp`,
    thumbnailUrl: `/media/${id}-thumbnail.webp`,
  };
}

describe('MemoryArtwork', () => {
  it('renders only the active photo and supports every carousel control', async () => {
    const user = userEvent.setup();
    const entry = {
      ...baseEntry,
      media: [media('one', 0), media('two', 1), media('three', 2)],
    };

    render(<MemoryArtwork entry={entry} tone="cedar" preview />);

    expect(
      screen.getByRole('region', {
        name: 'Stone Against the Desert photos',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/media/one-thumbnail.webp',
    );
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show next photo' }));
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/media/two-thumbnail.webp',
    );
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Show previous photo' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Show previous photo' }),
    );
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/media/three-thumbnail.webp',
    );

    await user.click(screen.getByRole('button', { name: 'Show photo 2 of 3' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show photo 2 of 3' }),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('does not expose carousel controls for a single photograph', () => {
    render(
      <MemoryArtwork
        entry={{ ...baseEntry, media: [media('one', 0)] }}
        tone="cedar"
        preview
      />,
    );

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show next photo' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
  });
});
