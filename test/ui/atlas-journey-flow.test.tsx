/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AtlasData } from '@/app/lib/atlas/definitions';
import type {
  AtlasJourneyDetail,
  AtlasJourneyIndex,
} from '@/app/lib/atlas/journeys/definitions';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  createAtlasDraftAction: jest.fn(),
  resolveAtlasPlaceAction: jest.fn(),
  saveAtlasViewAction: jest.fn(),
}));

jest.mock('@/app/lib/actions/atlas-media', () => ({
  getAtlasEntryMediaAction: jest.fn(),
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: () => <div data-testid="memory-photos">Photographs</div>,
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: ({
    selectedJourneyStopId,
    onJourneyStopSelect,
  }: {
    selectedJourneyStopId?: string | null;
    onJourneyStopSelect?: (id: string) => void;
  }) => (
    <div data-testid="atlas-map">
      <output data-testid="selected-map-stop">
        {selectedJourneyStopId ?? 'none'}
      </output>
      <button
        type="button"
        onClick={() =>
          onJourneyStopSelect?.('00000000-0000-4000-8000-000000000002')
        }
      >
        Select second map stop
      </button>
    </div>
  ),
}));

const FIRST_MEMORY_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_MEMORY_ID = '00000000-0000-4000-8000-000000000002';
const JOURNEY_ID = '00000000-0000-4000-8000-000000000010';

const initialData: AtlasData = {
  entries: [
    {
      id: FIRST_MEMORY_ID,
      title: 'Sleeping Bear sunrise',
      description: 'First light over the dune.',
      placeLabel: 'Empire, Michigan',
      placeName: 'Sleeping Bear Dunes',
      placeLocality: 'Empire',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-06-01T12:00:00.000Z',
      visitedOn: '2026-06-01',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 44.9,
      longitude: -86.0,
      version: 1,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      media: [],
    },
    {
      id: SECOND_MEMORY_ID,
      title: 'Leland harbor',
      description: 'Fishtown at the end of the day.',
      placeLabel: 'Leland, Michigan',
      placeName: 'Fishtown',
      placeLocality: 'Leland',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-06-02T12:00:00.000Z',
      visitedOn: '2026-06-02',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 45.0,
      longitude: -85.76,
      version: 1,
      createdAt: '2026-06-02T12:00:00.000Z',
      updatedAt: '2026-06-02T12:00:00.000Z',
      media: [],
    },
  ],
  view: {
    latitude: 44.95,
    longitude: -85.88,
    zoom: 7,
    bearing: 0,
    pitch: 0,
  },
};

const journeyIndex: AtlasJourneyIndex = {
  journeys: [
    {
      id: JOURNEY_ID,
      title: 'Leelanau weekend',
      version: 1,
      updatedAt: '2026-06-03T12:00:00.000Z',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      memoryCount: 2,
      drawable: true,
      stops: [
        {
          entryId: FIRST_MEMORY_ID,
          position: 0,
          title: 'Sleeping Bear sunrise',
          placeLabel: 'Empire, Michigan',
          placeName: 'Sleeping Bear Dunes',
          visitedOn: '2026-06-01',
          latitude: 44.9,
          longitude: -86.0,
        },
        {
          entryId: SECOND_MEMORY_ID,
          position: 1,
          title: 'Leland harbor',
          placeLabel: 'Leland, Michigan',
          placeName: 'Fishtown',
          visitedOn: '2026-06-02',
          latitude: 45.0,
          longitude: -85.76,
        },
      ],
    },
  ],
  suggestions: [
    {
      key: 'a'.repeat(64),
      algorithmVersion: 1,
      source: 'atlas_history',
      reason: 'nearby_dates_and_places',
      explanation: 'These 2 memories are dated within 2 days near Leelanau.',
      suggestedTitle: 'Leelanau memories',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      memoryCount: 2,
      entryIds: [FIRST_MEMORY_ID, SECOND_MEMORY_ID],
    },
  ],
};

const journeyDetail: AtlasJourneyDetail = {
  ...journeyIndex.journeys[0],
  introduction: 'A remembered path along the lakeshore.',
  stops: journeyIndex.journeys[0].stops.map((stop) => ({
    ...stop,
    description:
      stop.entryId === FIRST_MEMORY_ID
        ? 'First light over the dune.'
        : 'Fishtown at the end of the day.',
    transitionNote: stop.position ? 'Then we followed the shoreline.' : '',
    thumbnailUrl: null,
    thumbnailAlt: '',
  })),
};

function response(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

describe('Atlas Journey Lens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((input) =>
      String(input).includes(`/${JOURNEY_ID}`)
        ? response({ journey: journeyDetail })
        : response(journeyIndex),
    );
  });

  it('opens a journey, relives it, and keeps map-stop selection in sync', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /Leelanau weekend/i }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      `/dashboard?view=journeys&journey=${JOURNEY_ID}`,
      { scroll: false },
    );

    await user.click(screen.getByRole('button', { name: 'Relive' }));
    expect(await screen.findByText('First light over the dune.')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Select second map stop' }),
    );

    expect(
      await screen.findByText('Fishtown at the end of the day.'),
    ).toBeVisible();
    expect(screen.getByTestId('selected-map-stop')).toHaveTextContent(
      SECOND_MEMORY_ID,
    );
  });

  it('carries reviewed suggestion context into the Chapter workshop link', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const link = screen.getByRole('link', { name: /Shape chapter/i });
    const href = link.getAttribute('href') ?? '';
    const url = new URL(href, 'https://field-atlas.test');

    expect(url.searchParams.getAll('memory')).toEqual([
      FIRST_MEMORY_ID,
      SECOND_MEMORY_ID,
    ]);
    expect(url.searchParams.get('title')).toBe('Leelanau memories');
    expect(url.searchParams.get('suggestion')).toBe('a'.repeat(64));
    expect(url.searchParams.get('suggestionSource')).toBe('atlas_history');
  });

  it('returns focus to the Journey toolbar control when the panel closes', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );
    const close = await screen.findByRole('button', {
      name: 'Close journeys',
    });
    await user.click(close);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Open journey list' }),
      ).toHaveFocus(),
    );
  });
});
