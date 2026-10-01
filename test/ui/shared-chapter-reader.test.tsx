/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { SharedAtlasChapter } from '@/app/lib/chapters/definitions';
import { ChapterReader } from '@/components/chapters/chapter-reader';
import { ChapterSaveNotice } from '@/components/chapters/chapter-save-notice';

const mockChapterMapLoader = jest.fn();

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
  ChapterMapLoader: (props: { entries: unknown[] }) => {
    mockChapterMapLoader(props);
    return <div data-testid="chapter-map">Chapter map</div>;
  },
}));

const chapter: SharedAtlasChapter = {
  id: 'chapter-1',
  title: 'Wonders without borders',
  introduction:
    'Ten places across the world, held together as one remembered journey.',
  version: 1,
  memoryCount: 2,
  startDate: '2026-01-03',
  endDate: '2026-02-12',
  coverMedia: null,
  coverMediaId: null,
  visibility: 'shared',
  shareId: 'share-1',
  shareMap: true,
  shareLocationPrecision: 'approximate',
  createdAt: '2026-01-04T00:00:00.000Z',
  updatedAt: '2026-01-04T00:00:00.000Z',
  segments: [],
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
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 30.3,
      longitude: 35.4,
      version: 1,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      media: [],
      transitionNote: '',
      segmentId: null,
    },
    {
      id: 'memory-2',
      title: 'Kyoto by lantern light',
      description: 'A quiet evening beneath the lanterns of Gion.',
      placeLabel: 'Kyoto, Japan',
      placeName: 'Kyoto',
      placeLocality: 'Kyoto',
      placeRegion: 'Kyoto',
      placeCountry: 'Japan',
      placeCountryCode: 'JP',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-02-12T00:00:00.000Z',
      visitedOn: '2026-02-12',
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 35,
      longitude: 135.8,
      version: 1,
      createdAt: '2026-02-12T00:00:00.000Z',
      updatedAt: '2026-02-12T00:00:00.000Z',
      media: [],
      transitionNote: 'Eastward, desert stone gave way to lantern light.',
      segmentId: null,
    },
  ],
};

describe('shared Chapter reader', () => {
  afterEach(() => {
    mockChapterMapLoader.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('uses Journey labels without rewriting the author’s chapter wording', () => {
    const authoredTitle = 'Chapter one: the journey begins';
    const authoredIntroduction = 'A chapter I never want to forget.';
    render(
      <ChapterReader
        chapter={{
          ...chapter,
          title: authoredTitle,
          introduction: authoredIntroduction,
        }}
        mode="shared"
      />,
    );

    expect(
      screen.getByRole('heading', { name: authoredTitle }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Journey introduction' }),
    ).toHaveTextContent(authoredIntroduction);
    expect(
      screen.getByText('A shared Field Atlas journey'),
    ).toBeInTheDocument();
    expect(screen.getByText('The journey')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Journey actions' }),
    ).toBeInTheDocument();
  });

  it('presents an editorial public journey without exposing private keepsakes', () => {
    render(<ChapterReader chapter={chapter} mode="shared" />);

    expect(
      screen.getByRole('button', { name: 'Share journey' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start your atlas' }),
    ).toHaveAttribute('href', '/sign-up');
    expect(
      screen.getByRole('link', { name: /Begin the journey/i }),
    ).toHaveAttribute('href', '#chapter-story');
    const route = screen
      .getByText('From Petra, Jordan to Kyoto, Japan', {
        selector: '.sr-only',
      })
      .closest('p')!;
    expect(route).toHaveTextContent('Petra, Jordan');
    expect(route).toHaveTextContent('Kyoto, Japan');
    expect(screen.queryByText('Round trip')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Journey introduction' }),
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
    const journey = screen.getByRole('list', {
      name: 'Journey memories in route order',
    });
    expect(journey).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(journey).toHaveTextContent('Between stops');
    expect(journey).toHaveTextContent(
      'Eastward, desert stone gave way to lantern light.',
    );
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

  it('offers the full-image gallery to shared and owner readers while preserving owner navigation', async () => {
    const user = userEvent.setup();
    const chapterWithPhoto = {
      ...chapter,
      entries: chapter.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              media: [
                {
                  id: 'petra-photo-1',
                  entryId: entry.id,
                  mimeType: 'image/webp',
                  width: 1200,
                  height: 800,
                  byteSize: 24_000,
                  altText: 'Petra glowing at dawn',
                  sortOrder: 0,
                  createdAt: '2026-01-03T00:00:00.000Z',
                  deliveryUrl: '/shared/petra-photo-1.webp',
                  thumbnailUrl: '/shared/petra-photo-1-thumbnail.webp',
                },
              ],
            }
          : entry,
      ),
    } satisfies SharedAtlasChapter;

    const { rerender } = render(
      <ChapterReader chapter={chapterWithPhoto} mode="shared" />,
    );
    expect(
      screen.getByRole('button', {
        name: 'View Petra at dawn photo 1 full size',
      }),
    ).toBeInTheDocument();

    rerender(<ChapterReader chapter={chapterWithPhoto} mode="owner" />);
    const ownerGalleryTrigger = screen.getByRole('button', {
      name: 'View Petra at dawn photo 1 full size',
    });
    expect(ownerGalleryTrigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(
      screen.getByRole('link', { name: /Open Petra at dawn keepsake/i }),
    ).toHaveAttribute('href', '/dashboard/card/memory-1');

    await user.click(ownerGalleryTrigger);
    expect(
      screen.getByRole('dialog', { name: 'Petra at dawn' }),
    ).toBeInTheDocument();
  });

  it('preserves the featured destination when a journey returns to its origin', () => {
    const origin = {
      ...chapter.entries[0],
      id: 'grand-blanc-start',
      title: 'Leaving home',
      placeLabel: 'Grand Blanc',
      placeName: 'Grand Blanc',
      placeLocality: 'Grand Blanc',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      latitude: 42.9275,
      longitude: -83.63,
    };
    const destination = {
      ...chapter.entries[1],
      id: 'leadville',
      title: 'Above the clouds',
      placeLabel: 'Leadville',
      placeName: 'Leadville',
      placeLocality: 'Leadville',
      placeRegion: 'Colorado',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      latitude: 39.2508,
      longitude: -106.2925,
    };
    const returned = {
      ...origin,
      id: 'grand-blanc-return',
      title: 'Home again',
      latitude: 42.93,
      longitude: -83.62,
    };

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          memoryCount: 3,
          entries: [origin, destination, returned],
        }}
        mode="shared"
      />,
    );

    const route = screen
      .getByText(
        'Round trip from Grand Blanc via Leadville, returning to Grand Blanc',
        { selector: '.sr-only' },
      )
      .closest('p')!;
    expect(within(route).getByText('Grand Blanc')).toBeInTheDocument();
    expect(within(route).getByText('Leadville')).toBeInTheDocument();
    expect(within(route).getByText('Round trip')).toBeInTheDocument();
    expect(route.querySelectorAll('svg')).toHaveLength(2);
  });

  it('summarizes a short same-area return without a duplicate arrow', () => {
    const origin = {
      ...chapter.entries[0],
      id: 'local-start',
      placeLabel: 'Grand Blanc',
      placeName: 'Grand Blanc',
      placeLocality: 'Grand Blanc',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      latitude: 42.9275,
      longitude: -83.63,
    };
    const nearby = {
      ...chapter.entries[1],
      id: 'local-stop',
      placeLabel: 'Flint',
      placeName: 'Flint',
      placeLocality: 'Flint',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      latitude: 43.0125,
      longitude: -83.6875,
    };

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          memoryCount: 3,
          entries: [
            origin,
            nearby,
            {
              ...origin,
              id: 'local-return',
              latitude: 42.93,
              longitude: -83.62,
            },
          ],
        }}
        mode="shared"
      />,
    );

    const route = screen
      .getByText('Around Grand Blanc', { selector: '.sr-only' })
      .closest('p')!;
    expect(route).toHaveTextContent('Around Grand Blanc');
    expect(route).not.toHaveTextContent('Round trip');
    expect(route.querySelector('svg')).toBeNull();
  });

  it('keeps the owner opening concise and hands focus to its field note', async () => {
    render(<ChapterReader chapter={chapter} mode="owner" />);

    expect(screen.getByRole('link', { name: 'Open in Atlas' })).toHaveAttribute(
      'href',
      '/dashboard?view=journeys&journey=chapter-1',
    );
    expect(screen.getByRole('link', { name: 'Edit journey' })).toHaveAttribute(
      'href',
      '/dashboard/chapters/chapter-1/edit',
    );
    expect(
      screen.getByRole('link', { name: 'Continue journey' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/chapters/chapter-1/edit?step=continue',
    );
    expect(screen.getByRole('link', { name: 'Read journey' })).toHaveAttribute(
      'href',
      '#chapter-story',
    );
    expect(
      screen.getByRole('region', { name: 'Journey introduction' }),
    ).toHaveTextContent('Ten places across the world');
    const ownerHero = screen
      .getByRole('heading', { name: 'Wonders without borders', level: 1 })
      .closest('header');
    expect(ownerHero).not.toHaveTextContent('Ten places across the world');

    fireEvent.click(screen.getByRole('link', { name: 'Read journey' }));
    await waitFor(() =>
      expect(screen.getByText('The field note')).toHaveFocus(),
    );
    expect(
      screen.getByRole('list', {
        name: 'Journey memories in route order',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open Petra at dawn keepsake/i }),
    ).toHaveAttribute('href', '/dashboard/card/memory-1');
  });

  it('opens only the latest Journey day by default and reveals a day from the Segment index', async () => {
    const user = userEvent.setup();
    const scrollIntoView = jest.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const firstSegment = {
      id: 'e8ef6529-4961-4847-8272-e0da4aebf38b',
      title: 'Day 1 · Petra',
      position: 0,
      memoryCount: 1,
      startDate: '2026-01-03',
      endDate: '2026-01-03',
    };
    const secondSegment = {
      id: 'c47412f0-b990-421d-9321-693f153bd2d1',
      title: 'Day 2 · Kyoto',
      position: 1,
      memoryCount: 1,
      startDate: '2026-02-12',
      endDate: '2026-02-12',
    };

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          segments: [firstSegment, secondSegment],
          entries: [
            { ...chapter.entries[0], segmentId: firstSegment.id },
            { ...chapter.entries[1], segmentId: secondSegment.id },
          ],
        }}
        mode="owner"
      />,
    );

    const segmentIndex = screen.getByRole('navigation', {
      name: 'Journey segments',
    });
    expect(segmentIndex).toHaveTextContent(firstSegment.title);
    expect(segmentIndex).toHaveTextContent(secondSegment.title);
    expect(
      screen.getByRole('link', { name: 'Continue journey' }),
    ).toHaveAttribute(
      'href',
      `/dashboard/chapters/chapter-1/edit?step=continue&continueSegment=${secondSegment.id}`,
    );
    expect(
      screen.getByRole('heading', { name: new RegExp(firstSegment.title) }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: new RegExp(secondSegment.title) }),
    ).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Add memory' })).toHaveLength(2);
    const firstToggle = screen.getByRole('button', {
      name: `Segment 01: ${firstSegment.title}`,
    });
    const secondToggle = screen.getByRole('button', {
      name: `Segment 02: ${secondSegment.title}`,
    });
    const firstPanel = document.getElementById(
      firstToggle.getAttribute('aria-controls')!,
    );
    const secondPanel = document.getElementById(
      secondToggle.getAttribute('aria-controls')!,
    );

    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    expect(firstPanel).toHaveAttribute('hidden');
    expect(secondPanel).not.toHaveAttribute('hidden');

    await user.click(firstToggle);
    expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    expect(firstPanel).not.toHaveAttribute('hidden');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(firstToggle);
    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    expect(firstPanel).toHaveAttribute('hidden');

    await user.click(secondToggle);
    expect(secondToggle).toHaveAttribute('aria-expanded', 'false');
    expect(secondPanel).toHaveAttribute('hidden');

    const secondSegmentLink = within(segmentIndex).getByRole('link', {
      name: new RegExp(secondSegment.title),
    });
    await user.click(secondSegmentLink);

    await waitFor(() => {
      expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
      expect(secondPanel).not.toHaveAttribute('hidden');
      expect(secondToggle).toHaveFocus();
    });
    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    expect(window.location.hash).toBe(`#journey-segment-${secondSegment.id}`);
    expect(secondSegmentLink).toHaveAttribute('aria-current', 'location');
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    await waitFor(
      () =>
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: 'auto',
          block: 'start',
        }),
      { timeout: 1_000 },
    );
    expect(
      screen.queryByRole('region', { name: secondSegment.title }),
    ).not.toBeInTheDocument();

    await act(async () => {
      window.history.pushState(null, '', '#chapter-memories');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(secondSegmentLink).not.toHaveAttribute('aria-current'),
    );
    expect(
      screen.queryByText('Eastward, desert stone gave way to lantern light.'),
    ).not.toBeInTheDocument();
  });

  it('passes segment titles and global memory numbers to the route map', () => {
    const firstSegment = {
      id: 'e8ef6529-4961-4847-8272-e0da4aebf38b',
      title: 'Day 1 · Petra',
      position: 0,
      memoryCount: 1,
      startDate: '2026-01-03',
      endDate: '2026-01-03',
    };
    const secondSegment = {
      id: 'c47412f0-b990-421d-9321-693f153bd2d1',
      title: 'Day 2 · Kyoto',
      position: 1,
      memoryCount: 1,
      startDate: '2026-02-12',
      endDate: '2026-02-12',
    };

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          segments: [firstSegment, secondSegment],
          entries: [
            { ...chapter.entries[0], segmentId: firstSegment.id },
            { ...chapter.entries[1], segmentId: secondSegment.id },
          ],
        }}
        mode="shared"
      />,
    );

    const mapEntries = mockChapterMapLoader.mock.calls.at(-1)?.[0]
      .entries as Array<Record<string, unknown>>;
    expect(mapEntries).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        memoryNumber: 1,
        segmentId: firstSegment.id,
        segmentTitle: firstSegment.title,
      }),
      expect.objectContaining({
        id: 'memory-2',
        memoryNumber: 2,
        segmentId: secondSegment.id,
        segmentTitle: secondSegment.title,
      }),
    ]);
  });

  it('keeps empty and non-contiguous persisted Segments uniquely addressable', async () => {
    const user = userEvent.setup();
    const firstSegment = {
      id: 'e8ef6529-4961-4847-8272-e0da4aebf38b',
      title: 'Day 1 · Petra',
      position: 0,
      memoryCount: 2,
      startDate: '2026-01-03',
      endDate: '2026-01-05',
    };
    const secondSegment = {
      id: 'c47412f0-b990-421d-9321-693f153bd2d1',
      title: 'Day 2 · Kyoto',
      position: 1,
      memoryCount: 1,
      startDate: '2026-02-12',
      endDate: '2026-02-12',
    };
    const emptySegment = {
      id: '466117e5-a4b9-4117-a96e-9075085f1755',
      title: 'Day 3 · Homeward',
      position: 2,
      memoryCount: 0,
      startDate: null,
      endDate: null,
    };

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          memoryCount: 3,
          segments: [firstSegment, secondSegment, emptySegment],
          entries: [
            { ...chapter.entries[0], segmentId: firstSegment.id },
            { ...chapter.entries[1], segmentId: secondSegment.id },
            {
              ...chapter.entries[0],
              id: 'memory-3',
              title: 'Petra at dusk',
              segmentId: firstSegment.id,
            },
          ],
        }}
        mode="shared"
      />,
    );

    expect(
      document.querySelectorAll(`#journey-segment-${firstSegment.id}`),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole('button', {
        name: `Segment 01: ${firstSegment.title}`,
      }),
    ).toHaveLength(1);
    const firstToggle = screen.getByRole('button', {
      name: `Segment 01: ${firstSegment.title}`,
    });
    const latestToggle = screen.getByRole('button', {
      name: `Segment 03: ${emptySegment.title}`,
    });
    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    expect(latestToggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(firstToggle);
    expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    expect(latestToggle).toHaveAttribute('aria-expanded', 'true');

    expect(
      screen.getByRole('list', {
        name: `Segment 01: ${firstSegment.title} memories`,
      }),
    ).toHaveTextContent('Petra at dawn');
    expect(
      screen.getByRole('list', {
        name: `Segment 01: ${firstSegment.title} memories`,
      }),
    ).toHaveTextContent('Petra at dusk');
    expect(
      screen.getByRole('list', {
        name: `Segment 03: ${emptySegment.title} memories`,
      }),
    ).toHaveTextContent('No memories saved here yet.');
    expect(
      screen.getByRole('link', { name: new RegExp(emptySegment.title) }),
    ).toHaveAttribute('href', `#journey-segment-${emptySegment.id}`);
    expect(
      Array.from(
        document.querySelectorAll('.keepsake-card-row-copy h3'),
        (heading) => heading.textContent,
      ),
    ).toEqual(['Petra at dawn', 'Petra at dusk', 'Kyoto by lantern light']);
    expect(
      Array.from(
        document.querySelectorAll('.keepsake-card-index'),
        (index) => index.textContent,
      ),
    ).toEqual(['01', '02', '03']);
    expect(
      screen.queryByText('Eastward, desert stone gave way to lantern light.'),
    ).not.toBeInTheDocument();
  });

  it('reveals memories outside a Segment when continuation returns to their hash', async () => {
    const latestSegment = {
      id: 'c47412f0-b990-421d-9321-693f153bd2d1',
      title: 'Day 2 · Kyoto',
      position: 1,
      memoryCount: 1,
      startDate: '2026-02-12',
      endDate: '2026-02-12',
    };
    window.history.replaceState(
      null,
      '',
      '/dashboard/chapters/chapter-1?saved=continued#journey-segment-unsegmented',
    );

    render(
      <ChapterReader
        chapter={{
          ...chapter,
          segments: [latestSegment],
          entries: [
            { ...chapter.entries[0], segmentId: null },
            { ...chapter.entries[1], segmentId: latestSegment.id },
          ],
        }}
        mode="owner"
      />,
    );

    const unsegmentedToggle = screen.getByRole('button', {
      name: 'Journey start: Before the first segment',
    });
    const latestToggle = screen.getByRole('button', {
      name: `Segment 02: ${latestSegment.title}`,
    });
    await waitFor(() =>
      expect(unsegmentedToggle).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(latestToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Petra at dawn')).toBeVisible();
  });

  it('keeps the active Segment hash when the save confirmation is dismissed', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      null,
      '',
      '/dashboard/chapters/chapter-1?saved=continued&from=atlas#journey-segment-segment-1',
    );

    render(<ChapterSaveNotice chapterId="chapter-1" kind="continued" />);
    await user.click(
      screen.getByRole('button', { name: 'Dismiss save confirmation' }),
    );

    expect(window.location.pathname).toBe('/dashboard/chapters/chapter-1');
    expect(window.location.search).toBe('?from=atlas');
    expect(window.location.hash).toBe('#journey-segment-segment-1');
    expect(screen.queryByText('Memory added.')).not.toBeInTheDocument();
  });

  it('sends the opening action to the route when there is no field note', () => {
    render(
      <ChapterReader
        chapter={{ ...chapter, introduction: '' }}
        mode="shared"
      />,
    );

    expect(
      screen.getByRole('link', { name: 'Begin the journey' }),
    ).toHaveAttribute('href', '#chapter-route');
    expect(
      screen.queryByRole('region', { name: 'Journey introduction' }),
    ).not.toBeInTheDocument();
  });

  it('does not expose the private Atlas route from the shared reader', () => {
    render(<ChapterReader chapter={chapter} mode="shared" />);

    expect(
      screen.queryByRole('link', { name: 'Open in Atlas' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Continue journey' }),
    ).not.toBeInTheDocument();
  });
});
