/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  createAtlasDraftAction,
  resolveAtlasPlaceAction,
} from '@/app/lib/actions/atlas';
import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasJourneyContinuation } from '@/app/lib/chapters/definitions';
import { JourneyMemoryComposer } from '@/components/chapters/journey-memory-composer';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  createAtlasDraftAction: jest.fn(),
  resolveAtlasPlaceAction: jest.fn(),
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: ({
    initialView,
    onPlace,
    onViewChange,
  }: {
    initialView: AtlasView;
    onPlace: (coordinates: { latitude: number; longitude: number }) => void;
    onViewChange: (view: AtlasView) => void;
  }) => (
    <div data-testid="continuation-map">
      <output>
        {initialView.latitude}, {initialView.longitude}
      </output>
      <button
        type="button"
        onClick={() =>
          onViewChange({
            latitude: 45.75,
            longitude: -86.25,
            zoom: 11,
            bearing: 0,
            pitch: 0,
          })
        }
      >
        Move map
      </button>
      <button
        type="button"
        onClick={() => onPlace({ latitude: 45.5, longitude: -86 })}
      >
        Tap map
      </button>
    </div>
  ),
}));

jest.mock('@/components/atlas/memory-drawer', () => ({
  MemoryDrawer: ({
    continuationJourney,
    onArchive,
    onContinuationSaved,
    surface,
  }: {
    continuationJourney: AtlasJourneyContinuation;
    onArchive: (id: string) => void;
    onContinuationSaved: (entry: AtlasEntry) => void;
    surface: string;
  }) => (
    <div role="dialog" aria-label="Create memory">
      <span>{continuationJourney.title}</span>
      <span>{continuationJourney.selectedSegmentId}</span>
      <span>{surface}</span>
      <button type="button" onClick={() => onContinuationSaved(entry)}>
        Finish memory
      </button>
      <button type="button" onClick={() => onArchive(entry.id)}>
        Cancel memory
      </button>
    </div>
  ),
}));

const entry: AtlasEntry = {
  id: '00000000-0000-4000-8000-000000000011',
  title: '',
  description: '',
  placeLabel: '',
  placeName: null,
  placeLocality: null,
  placeRegion: null,
  placeCountry: null,
  placeCountryCode: null,
  placeGeocoder: null,
  placeGeocodedAt: null,
  visitedOn: null,
  occurredTime: null,
  occurredUtcOffsetMinutes: null,
  recordState: 'draft',
  journeyState: 'visited',
  latitude: 45.25,
  longitude: -86.5,
  version: 1,
  createdAt: '2026-09-28T12:00:00.000Z',
  updatedAt: '2026-09-28T12:00:00.000Z',
  media: [],
};

const journey: AtlasJourneyContinuation = {
  id: '00000000-0000-4000-8000-000000000010',
  title: 'Leelanau week',
  memoryCount: 8,
  segments: [
    {
      id: '00000000-0000-4000-8000-000000000012',
      title: 'Day 3 · The coast',
      position: 2,
      memoryCount: 3,
      startDate: '2026-09-27',
      endDate: '2026-09-27',
    },
  ],
  selectedSegmentId: '00000000-0000-4000-8000-000000000012',
  latestMemoryDate: '2026-09-27',
  latestMemoryLocation: { latitude: 45.25, longitude: -86.5 },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createAtlasDraftAction).mockResolvedValue({
    ok: true,
    data: entry,
  });
  jest.mocked(resolveAtlasPlaceAction).mockResolvedValue({
    ok: true,
    data: {
      entryId: entry.id,
      place: {
        placeName: 'Leland',
        locality: 'Leland',
        region: 'Michigan',
        country: 'United States',
        countryCode: 'US',
        geocoder: 'test',
        geocodedAt: '2026-09-28T12:00:00.000Z',
      },
    },
  });
});

it('starts at the latest Journey stop and opens the scoped Memory editor', async () => {
  const user = userEvent.setup();
  render(<JourneyMemoryComposer journey={journey} />);

  expect(screen.getByTestId('continuation-map')).toHaveTextContent(
    '45.25, -86.5',
  );
  expect(screen.getByText('Day 3 · The coast')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Move map' }));
  await user.click(screen.getByRole('button', { name: 'Use map center' }));

  await waitFor(() =>
    expect(createAtlasDraftAction).toHaveBeenCalledWith({
      clientRequestId: expect.any(String),
      latitude: 45.75,
      longitude: -86.25,
    }),
  );
  const editor = await screen.findByRole('dialog', { name: 'Create memory' });
  expect(editor).toHaveTextContent(journey.title);
  expect(editor).toHaveTextContent(journey.selectedSegmentId!);
  expect(editor).toHaveTextContent('journey-editor');
  expect(resolveAtlasPlaceAction).toHaveBeenCalledWith(entry.id);

  await user.click(screen.getByRole('button', { name: 'Finish memory' }));
  expect(mockPush).toHaveBeenCalledWith(
    `/dashboard/chapters/${journey.id}?saved=continued#chapter-memories`,
  );
});

it('returns to the Journey when a new Memory is cancelled', async () => {
  const user = userEvent.setup();
  render(<JourneyMemoryComposer journey={journey} />);

  await user.click(screen.getByRole('button', { name: 'Tap map' }));
  await screen.findByRole('dialog', { name: 'Create memory' });
  await user.click(screen.getByRole('button', { name: 'Cancel memory' }));

  expect(mockPush).toHaveBeenCalledWith(`/dashboard/chapters/${journey.id}`);
});
