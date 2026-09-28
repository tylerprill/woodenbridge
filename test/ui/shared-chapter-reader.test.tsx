/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
    expect(
      screen.getByLabelText('From Petra, Jordan to Kyoto, Japan'),
    ).toHaveTextContent('Petra, Jordan');
    expect(
      screen.getByLabelText('From Petra, Jordan to Kyoto, Japan'),
    ).toHaveTextContent('Kyoto, Japan');
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

  it('keeps the owner opening concise and hands focus to its field note', async () => {
    render(<ChapterReader chapter={chapter} mode="owner" />);

    expect(screen.getByRole('link', { name: 'Journeys' })).toHaveAttribute(
      'href',
      '/dashboard/chapters',
    );
    expect(screen.getByRole('link', { name: 'Edit journey' })).toHaveAttribute(
      'href',
      '/dashboard/chapters/chapter-1/edit',
    );
    expect(screen.getByRole('link', { name: 'View on Atlas' })).toHaveAttribute(
      'href',
      '/dashboard?view=journeys&journey=chapter-1',
    );
    expect(
      screen.getByRole('link', { name: 'Continue journey' }),
    ).toHaveAttribute(
      'href',
      '/dashboard?new=memory&continueJourney=chapter-1',
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

  it('groups a multi-day Journey into scalable Segments and continues the latest one', () => {
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
      `/dashboard?new=memory&continueJourney=chapter-1&continueSegment=${secondSegment.id}`,
    );
    expect(
      screen.getByRole('heading', { name: firstSegment.title }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: secondSegment.title }),
    ).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Add memory' })).toHaveLength(2);
    expect(
      screen.queryByText('Eastward, desert stone gave way to lantern light.'),
    ).not.toBeInTheDocument();
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
      screen.queryByRole('link', { name: 'View on Atlas' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Continue journey' }),
    ).not.toBeInTheDocument();
  });
});
