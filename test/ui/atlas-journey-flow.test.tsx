/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, within } from '@testing-library/react';
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
const FIRST_SEGMENT_ID = '00000000-0000-4000-8000-000000000020';
const SECOND_SEGMENT_ID = '00000000-0000-4000-8000-000000000021';

const initialData: AtlasData = {
  hasSavedView: true,
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
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
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
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
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
      segments: [
        {
          id: FIRST_SEGMENT_ID,
          title: 'Dune sunrise',
          position: 0,
          memoryCount: 1,
          startDate: '2026-06-01',
          endDate: '2026-06-01',
        },
        {
          id: SECOND_SEGMENT_ID,
          title: 'Harbor evening',
          position: 1,
          memoryCount: 1,
          startDate: '2026-06-02',
          endDate: '2026-06-02',
        },
      ],
      stops: [
        {
          entryId: FIRST_MEMORY_ID,
          position: 0,
          segmentId: FIRST_SEGMENT_ID,
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
          segmentId: SECOND_SEGMENT_ID,
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
      explanation: 'These memories may belong together.',
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

  it('keeps Add memory available from the Memories side of Atlas', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Memories' }));
    await user.click(screen.getByRole('button', { name: 'Add memory' }));

    expect(screen.getByRole('button', { name: 'Cancel pin' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('can open directly in the new-memory placement state', () => {
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialPlacementMode
      />,
    );

    expect(
      screen.getByRole('region', { name: 'Place a memory' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel pin' })).toBeVisible();
  });

  it('keeps Journey context while placing its next memory', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialPlacementMode
        continuationJourney={{
          id: JOURNEY_ID,
          title: 'Leelanau weekend',
          memoryCount: 2,
          segments: [],
          selectedSegmentId: null,
          latestMemoryDate: '2026-09-28',
          latestMemoryLocation: null,
        }}
      />,
    );

    expect(screen.getByText('Continue Leelanau weekend')).toBeVisible();
    expect(
      screen.getByText(
        'Choose where the next memory in this journey happened.',
      ),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cancel pin' }));
    expect(mockPush).toHaveBeenCalledWith(`/dashboard/chapters/${JOURNEY_ID}`);
  });

  it('keeps journey creation and suggestions off Atlas', async () => {
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    const tray = await screen.findByRole('region', { name: 'Your journeys' });
    expect(
      await within(tray).findByRole('link', { name: 'All journeys' }),
    ).toHaveAttribute('href', '/dashboard/chapters');
    expect(
      screen.queryByRole('button', { name: /create journey/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Review' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /upload/i }),
    ).not.toBeInTheDocument();

    const requestUrl = String(jest.mocked(global.fetch).mock.calls[0]?.[0]);
    expect(
      new URL(requestUrl, 'https://field-atlas.test').searchParams.has(
        'suggestions',
      ),
    ).toBe(false);
  });

  it('guides an empty Journey lens to the dedicated list and memory flow', async () => {
    global.fetch = jest.fn(() =>
      response({ journeys: [], suggestions: [] } satisfies AtlasJourneyIndex),
    );
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={{ ...initialData, entries: [] }}
        initialMode="journeys"
      />,
    );

    const tray = await screen.findByRole('region', { name: 'Your journeys' });
    expect(
      await within(tray).findByRole('link', { name: 'Open Journeys' }),
    ).toHaveAttribute('href', '/dashboard/chapters');
    expect(
      within(tray).getByRole('link', { name: 'Add memory' }),
    ).toHaveAttribute('href', '/dashboard?new=memory');
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

  it('organizes a remembered path by Journey, Segment, and Memory', async () => {
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

    const firstSegment = screen.getByRole('button', {
      name: /Segment 01 Dune sunrise/i,
    });
    const secondSegment = screen.getByRole('button', {
      name: /Segment 02 Harbor evening/i,
    });
    expect(firstSegment).toHaveAttribute('aria-expanded', 'true');
    expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('list', {
        name: 'Segment 01: Dune sunrise memories',
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole('list', {
        name: 'Segment 02: Harbor evening memories',
      }),
    ).not.toBeInTheDocument();

    await user.click(secondSegment);
    expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
    expect(secondSegment).toHaveAttribute('aria-expanded', 'true');
    const secondPanelId = secondSegment.getAttribute('aria-controls');
    expect(secondPanelId).toBeTruthy();
    expect(
      document.getElementById(secondPanelId as string),
    ).not.toHaveAttribute('hidden');
    expect(
      within(
        screen.getByRole('list', {
          name: 'Segment 02: Harbor evening memories',
        }),
      ).getByRole('button', { name: /^2 Leland harbor/i }),
    ).toBeVisible();

    await user.click(secondSegment);
    expect(secondSegment).toHaveAttribute('aria-expanded', 'false');

    await user.click(
      screen.getByRole('button', { name: 'Select second map stop' }),
    );

    expect(firstSegment).toHaveAttribute('aria-expanded', 'false');
    expect(secondSegment).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(
        screen.getByRole('list', {
          name: 'Segment 02: Harbor evening memories',
        }),
      ).getByRole('button', { name: /Leland harbor/i }),
    ).toHaveAttribute('aria-current', 'step');

    await user.click(secondSegment);
    expect(secondSegment).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('selected-map-stop')).toHaveTextContent('none');

    await user.click(
      screen.getByRole('button', { name: 'Select second map stop' }),
    );
    expect(secondSegment).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(
        screen.getByRole('list', {
          name: 'Segment 02: Harbor evening memories',
        }),
      ).getByRole('button', { name: /Leland harbor/i }),
    ).toHaveAttribute('aria-current', 'step');
  });

  it('keeps legacy journeys without segments as a flat memory list', async () => {
    const user = userEvent.setup();
    const legacyJourney: AtlasJourneyIndex = {
      ...journeyIndex,
      journeys: [
        {
          ...journeyIndex.journeys[0],
          segments: [],
          stops: journeyIndex.journeys[0].stops.map((stop) => ({
            ...stop,
            segmentId: null,
          })),
        },
      ],
    };
    global.fetch = jest.fn(() => response(legacyJourney));

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

    expect(
      screen.getByRole('list', { name: 'Leelanau weekend stops' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Segment 01/i }),
    ).not.toBeInTheDocument();
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
