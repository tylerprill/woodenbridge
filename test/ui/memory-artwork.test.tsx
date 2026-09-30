/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
  occurredTime: null,
  occurredUtcOffsetMinutes: null,
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

  it('opens an accessible full-image gallery only when explicitly enabled', async () => {
    const user = userEvent.setup();
    const entry = {
      ...baseEntry,
      media: [media('one', 0), media('two', 1), media('three', 2)],
    };

    const { rerender } = render(
      <MemoryArtwork entry={entry} tone="cedar" preview />,
    );
    expect(
      screen.queryByRole('button', { name: /photo 1 full size/i }),
    ).not.toBeInTheDocument();

    rerender(<MemoryArtwork entry={entry} tone="cedar" preview expandable />);
    const trigger = screen.getByRole('button', {
      name: /photo 1 full size/i,
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', {
      name: 'Stone Against the Desert',
    });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(dialog).getByRole('img', { name: 'Giza view 1' }),
    ).toHaveAttribute('src', '/media/one.webp');
    expect(
      within(dialog).getByRole('status', { name: 'Photo 1 of 3' }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Show next full-size photo',
      }),
    );
    expect(
      within(dialog).getByRole('img', { name: 'Giza view 2' }),
    ).toHaveAttribute('src', '/media/two.webp');

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Show full-size photo 3 of 3',
      }),
    );
    expect(
      within(dialog).getByRole('status', { name: 'Photo 3 of 3' }),
    ).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(
      within(dialog).getByRole('status', { name: 'Photo 2 of 3' }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('moves one photo per lightbox swipe and immediately reopens afterward', async () => {
    const user = userEvent.setup();
    const entry = {
      ...baseEntry,
      media: [media('one', 0), media('two', 1), media('three', 2)],
    };

    render(<MemoryArtwork entry={entry} tone="cedar" preview expandable />);
    const trigger = screen.getByRole('button', {
      name: /photo 1 full size/i,
    });
    await user.click(trigger);

    let dialog = screen.getByRole('dialog');
    const stage = within(dialog).getByRole('img', {
      name: 'Giza view 1',
    }).parentElement?.parentElement;
    expect(stage).not.toBeNull();
    fireEvent.touchStart(stage as HTMLElement, {
      touches: [{ clientX: 260, clientY: 120 }],
    });
    fireEvent.touchEnd(stage as HTMLElement, {
      changedTouches: [{ clientX: 120, clientY: 124 }],
    });

    expect(
      within(dialog).getByRole('status', { name: 'Photo 2 of 3' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('status', { name: 'Photo 3 of 3' }),
    ).not.toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Close full image' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole('button', { name: /photo 2 full size/i }),
    );
    dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('status', { name: 'Photo 2 of 3' }),
    ).toBeInTheDocument();
  });

  it('replaces a failed photograph without collapsing the artwork', () => {
    const { container } = render(
      <MemoryArtwork
        entry={{ ...baseEntry, media: [media('missing', 0)] }}
        tone="ember"
        preview
      />,
    );

    fireEvent.error(screen.getByRole('img'));

    expect(
      screen.getByRole('img', {
        name: 'Giza view 1 — photo unavailable',
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.atlas-memory-artwork-fallback'),
    ).toBeInTheDocument();
  });

  it('recovers when a carousel advances past a failed photograph', async () => {
    const user = userEvent.setup();
    render(
      <MemoryArtwork
        entry={{ ...baseEntry, media: [media('missing', 0), media('two', 1)] }}
        tone="cedar"
        preview
      />,
    );

    fireEvent.error(screen.getByRole('img'));
    await user.click(screen.getByRole('button', { name: 'Show next photo' }));

    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/media/two-thumbnail.webp',
    );
  });
});
