/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { getAtlasEntryMediaAction } from '@/app/lib/actions/atlas-media';
import type { AtlasData } from '@/app/lib/atlas/definitions';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  createAtlasDraftAction: jest.fn(),
  resolveAtlasPlaceAction: jest.fn(),
  saveAtlasViewAction: jest.fn(),
}));

jest.mock('@/app/lib/actions/atlas-media', () => ({
  getAtlasEntryMediaAction: jest.fn(),
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: () => <div data-testid="atlas-map">Atlas map</div>,
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: () => <div data-testid="memory-photos">Photographs</div>,
}));

const initialData: AtlasData = {
  entries: [
    {
      id: 'memory-1',
      title: 'Kyoto memory',
      description: 'Lanterns after rain.',
      placeLabel: 'Kyoto, Japan',
      placeName: 'Kyoto',
      placeLocality: 'Kyoto',
      placeRegion: 'Kyoto',
      placeCountry: 'Japan',
      placeCountryCode: 'JP',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-08-17T12:00:00.000Z',
      visitedOn: '2026-08-17',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 35.0116,
      longitude: 135.7681,
      version: 1,
      createdAt: '2026-08-17T12:00:00.000Z',
      updatedAt: '2026-08-17T12:00:00.000Z',
      media: [],
    },
  ],
  view: {
    latitude: 35.0116,
    longitude: 135.7681,
    zoom: 8,
    bearing: 0,
    pitch: 0,
  },
};

describe('Atlas workspace focus restoration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAtlasEntryMediaAction).mockResolvedValue({
      ok: true,
      data: [],
    });
  });

  it('returns focus to the Memories toggle after closing a tray memory', async () => {
    const user = userEvent.setup();
    render(<AtlasWorkspace displayName="Explorer" initialData={initialData} />);

    const memoryListToggle = screen.getByRole('button', {
      name: 'Open memory list',
    });
    await user.click(memoryListToggle);
    await user.click(screen.getByRole('button', { name: /Kyoto memory/ }));

    await screen.findByRole('dialog', { name: 'Edit memory' });
    await user.click(screen.getByRole('button', { name: 'Close memory' }));

    await waitFor(() => expect(memoryListToggle).toHaveFocus());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
