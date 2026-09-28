/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { render, screen, within } from '@testing-library/react';

import type { AtlasEntryPresentation } from '@/app/lib/atlas/definitions';
import type {
  RediscoveredMemory,
  RediscoveryData,
} from '@/app/lib/atlas/rediscovery/definitions';
import { OnThisDay } from '@/components/rediscovery/on-this-day';

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

function memory(
  id: string,
  overrides: Partial<AtlasEntryPresentation> = {},
): RediscoveredMemory {
  return {
    entry: {
      id,
      title: `A quiet day in ${id}`,
      description: 'The place was just as we remembered it.',
      placeLabel: 'Kyoto, Japan',
      placeName: 'Kyoto',
      placeLocality: 'Kyoto',
      placeRegion: 'Kyoto',
      placeCountry: 'Japan',
      placeCountryCode: 'JP',
      placeGeocoder: 'test',
      placeGeocodedAt: null,
      visitedOn: '2025-09-15',
      recordState: 'saved',
      journeyState: 'visited',
      version: 1,
      createdAt: '2025-09-15T00:00:00.000Z',
      updatedAt: '2025-09-15T00:00:00.000Z',
      media: [],
      ...overrides,
    },
    journey: null,
  };
}

function data(overrides: Partial<RediscoveryData> = {}): RediscoveryData {
  return {
    date: '2026-09-15',
    earliestDate: '2025-09-15',
    mode: 'anniversary',
    total: 1,
    page: 1,
    pageSize: 24,
    totalPages: 1,
    memories: [memory('Kyoto')],
    ...overrides,
  };
}

describe('On this day', () => {
  it('renders a private anniversary page and the date-controls slot', () => {
    render(
      <OnThisDay
        data={data()}
        controls={<button type="button">Find memories</button>}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'On this day' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Find memories' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Only you can see these memories.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Selected memory date' }),
    ).toHaveTextContent('September 15, 2026');
    expect(
      screen.getByText('1 memory from September 15 in earlier years.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Recent memories' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /share/i }),
    ).not.toBeInTheDocument();
  });

  it('groups anniversary matches by descending visit year', () => {
    render(
      <OnThisDay
        data={data({
          total: 3,
          memories: [
            memory('Petra', { visitedOn: '2022-09-15' }),
            memory('Kyoto', { visitedOn: '2025-09-15' }),
            memory('Nara', { visitedOn: '2025-09-15' }),
          ],
        })}
        controls={null}
      />,
    );

    const years = screen.getAllByRole('heading', { level: 2 });
    expect(years.map((heading) => heading.textContent)).toEqual([
      '2025',
      '2022',
    ]);
    expect(screen.getByText('1 year earlier')).toBeInTheDocument();
    expect(screen.getByText('4 years earlier')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '2025' })).getAllByRole(
        'article',
      ),
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('region', { name: '2022' })).getAllByRole(
        'article',
      ),
    ).toHaveLength(1);
  });

  it('describes year distance relative to the selected date, not today', () => {
    const { container } = render(
      <OnThisDay
        data={data({
          date: '2024-09-15',
          memories: [memory('Petra', { visitedOn: '2022-09-15' })],
        })}
        controls={null}
      />,
    );

    expect(screen.getByText('2 years earlier')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/years? ago/);
  });

  it('clearly labels recent fallback and marks its cards for uniform sizing', () => {
    const { container } = render(
      <OnThisDay
        data={data({
          mode: 'recent',
          pageSize: 6,
          memories: [
            memory('Kyoto', { visitedOn: '2026-09-10' }),
            memory('Nara', { description: '', visitedOn: '2026-09-09' }),
          ],
        })}
        controls={null}
      />,
    );

    expect(
      screen.getByText('No memories from September 15 in earlier years.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Recent memories' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('These are recent visits, not anniversary matches.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sep 10, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/years? earlier$/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-memory-grid="recent"]')).toHaveClass(
      'memoryGrid',
      'uniformMemoryGrid',
    );
  });

  it('invites uploading and opening Atlas when there are no memories', () => {
    const { container } = render(
      <OnThisDay
        data={data({
          earliestDate: null,
          mode: 'recent',
          total: 0,
          memories: [],
        })}
        controls={<button type="button">Find memories</button>}
      />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Your memories will meet you here.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No memories from September 15 in earlier years.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Find memories' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Selected memory date' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload photos' })).toHaveAttribute(
      'href',
      '/dashboard/import',
    );
    expect(screen.getByRole('link', { name: 'Open Atlas' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.queryByRole('navigation', { name: 'Memory pages' }),
    ).not.toBeInTheDocument();
  });

  it('keeps date exploration available when a populated atlas has no result for the selected day', () => {
    render(
      <OnThisDay
        data={data({ mode: 'recent', total: 0, memories: [] })}
        controls={<button type="button">Find memories</button>}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Find memories' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Selected memory date' }),
    ).toHaveTextContent('No memories from September 15 in earlier years.');
    expect(
      screen.getByRole('heading', { name: 'Try another day in your atlas.' }),
    ).toBeInTheDocument();
  });

  it('links owner memories, Atlas pins, and their journey without nested links', () => {
    const featuredMemory = memory('memory-1');
    featuredMemory.journey = { id: 'journey-1', title: 'Across the sea' };
    const { container } = render(
      <OnThisDay data={data({ memories: [featuredMemory] })} controls={null} />,
    );

    expect(
      screen.getByRole('link', {
        name: 'Open A quiet day in memory-1 memory — Kyoto, Japan',
      }),
    ).toHaveAttribute('href', '/dashboard/card/memory-1');
    expect(screen.getByRole('link', { name: 'View on Atlas' })).toHaveAttribute(
      'href',
      '/dashboard?memory=memory-1',
    );
    expect(
      screen.getByRole('link', { name: 'Read journey: Across the sea' }),
    ).toHaveAttribute('href', '/dashboard/chapters/journey-1');
    expect(container.querySelector('a a, a button')).toBeNull();
  });

  it('only renders a lazy derivative preview, preserving the private URL and alt text', () => {
    const photoMemory = memory('Kyoto', {
      media: [
        {
          id: 'photo-1',
          entryId: 'Kyoto',
          mimeType: 'image/jpeg',
          width: 1200,
          height: 800,
          byteSize: 200000,
          altText: 'A lantern above the quiet street',
          sortOrder: 0,
          createdAt: '2025-09-15T00:00:00.000Z',
          deliveryUrl: '/api/atlas/media/photo-1?grant=test-original',
          thumbnailUrl:
            '/api/atlas/media/photo-1?variant=thumbnail&grant=test-preview',
        },
      ],
    });
    render(
      <OnThisDay
        data={data({ total: 2, memories: [memory('Petra'), photoMemory] })}
        controls={null}
      />,
    );

    const image = screen.getByRole('img', {
      name: 'A lantern above the quiet street',
    });
    expect(image).toHaveAttribute(
      'src',
      '/api/atlas/media/photo-1?variant=thumbnail&grant=test-preview',
    );
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(image.getAttribute('src')).not.toContain('test-original');
  });

  it('keeps undated and photo-free recent memories readable', () => {
    const { container } = render(
      <OnThisDay
        data={data({
          mode: 'recent',
          memories: [memory('memory-1', { title: '', visitedOn: null })],
        })}
        controls={null}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 3, name: 'Untitled memory' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Date not set')).toBeInTheDocument();
    expect(container.querySelector('.bridge-card-art')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('preserves long author-written memory and journey titles', () => {
    const title = 'A chapter beside the sea '.repeat(10).trim();
    const journeyTitle = 'The journey we always dreamed of '.repeat(7).trim();
    const featuredMemory = memory('memory-1', { title });
    featuredMemory.journey = { id: 'journey-1', title: journeyTitle };
    render(
      <OnThisDay data={data({ memories: [featuredMemory] })} controls={null} />,
    );

    expect(
      screen.getByRole('heading', { level: 3, name: title }),
    ).toHaveTextContent(title);
    expect(
      screen.getByRole('link', { name: `Read journey: ${journeyTitle}` }),
    ).toHaveTextContent(journeyTitle);
  });

  it('renders a bounded 24-card anniversary page with a date-preserving next link', () => {
    render(
      <OnThisDay
        data={data({
          total: 49,
          totalPages: 3,
          memories: Array.from({ length: 24 }, (_, index) =>
            memory(`memory-${index}`),
          ),
        })}
        controls={null}
      />,
    );

    expect(screen.getAllByRole('article')).toHaveLength(24);
    expect(
      screen.getByRole('navigation', { name: 'Memory pages' }),
    ).toHaveTextContent('Page 1 of 3');
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-15&page=2',
    );
    expect(
      screen.queryByRole('link', { name: 'Previous' }),
    ).not.toBeInTheDocument();
  });

  it('offers previous and next pages in the middle without changing the selected day', () => {
    render(
      <OnThisDay
        data={data({ page: 2, totalPages: 3, total: 49 })}
        controls={null}
      />,
    );

    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-15',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-15&page=3',
    );
  });

  it('does not offer a next link on the final page or pagination for a recent fallback', () => {
    const { unmount } = render(
      <OnThisDay
        data={data({ page: 3, totalPages: 3, total: 49 })}
        controls={null}
      />,
    );
    expect(
      screen.queryByRole('link', { name: 'Next' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-15&page=2',
    );
    unmount();

    render(
      <OnThisDay
        data={data({ mode: 'recent', pageSize: 6 })}
        controls={null}
      />,
    );
    expect(
      screen.queryByRole('navigation', { name: 'Memory pages' }),
    ).not.toBeInTheDocument();
  });
});
