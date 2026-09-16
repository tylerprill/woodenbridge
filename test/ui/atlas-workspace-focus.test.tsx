/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { updateAtlasEntryAction } from '@/app/lib/actions/atlas';
import { getAtlasEntryMediaAction } from '@/app/lib/actions/atlas-media';
import type { AtlasData, AtlasMedia } from '@/app/lib/atlas/definitions';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';

const mockReplace = jest.fn();
const mockMemoryPhotosRender = jest.fn<
  void,
  [
    {
      media: AtlasMedia[];
      onChange: (media: AtlasMedia[]) => void;
      onBusyChange: (busy: boolean) => void;
    },
  ]
>();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  archiveAtlasEntryAction: jest.fn(),
  createAtlasDraftAction: jest.fn(),
  resolveAtlasPlaceAction: jest.fn(),
  saveAtlasViewAction: jest.fn(),
  updateAtlasEntryAction: jest.fn(),
}));

jest.mock('@/app/lib/actions/atlas-media', () => ({
  getAtlasEntryMediaAction: jest.fn(),
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: () => <div data-testid="atlas-map">Atlas map</div>,
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: (props: {
    media: AtlasMedia[];
    onChange: (media: AtlasMedia[]) => void;
    onBusyChange: (busy: boolean) => void;
  }) => {
    mockMemoryPhotosRender(props);
    return <div data-testid="memory-photos">Photographs</div>;
  },
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

  it('merges a late photo callback into the newest saved memory fields', async () => {
    const user = userEvent.setup();
    const updatedEntry = {
      ...initialData.entries[0],
      title: 'Kyoto after rain',
      description: 'Lanterns reflected in the street.',
      version: 2,
      updatedAt: '2026-08-17T13:00:00.000Z',
    };
    const photo: AtlasMedia = {
      id: 'photo-1',
      entryId: updatedEntry.id,
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
      byteSize: 512,
      altText: 'Lanterns after rain',
      sortOrder: 0,
      createdAt: '2026-08-17T13:01:00.000Z',
      deliveryUrl: '/api/atlas/media/photo-1',
      thumbnailUrl: '/api/atlas/media/photo-1?variant=thumbnail',
    };
    jest.mocked(updateAtlasEntryAction).mockResolvedValue({
      ok: true,
      data: updatedEntry,
    });

    render(<AtlasWorkspace displayName="Explorer" initialData={initialData} />);
    await user.click(screen.getByRole('button', { name: 'Open memory list' }));
    await user.click(screen.getByRole('button', { name: /Kyoto memory/ }));
    await screen.findByRole('dialog', { name: 'Edit memory' });

    const stalePhotoCallback =
      mockMemoryPhotosRender.mock.calls.at(-1)?.[0].onChange;
    const title = screen.getByRole('textbox', { name: 'Title' });
    const note = screen.getByRole('textbox', { name: /Field note/ });
    await user.clear(title);
    await user.type(title, updatedEntry.title);
    await user.clear(note);
    await user.type(note, updatedEntry.description);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Saved to your atlas');

    act(() => stalePhotoCallback?.([photo]));
    await user.click(screen.getByRole('button', { name: 'Close memory' }));
    await user.click(screen.getByRole('button', { name: 'Open memory list' }));
    await user.click(screen.getByRole('button', { name: /Kyoto after rain/ }));

    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      updatedEntry.title,
    );
    expect(screen.getByRole('textbox', { name: /Field note/ })).toHaveValue(
      updatedEntry.description,
    );
    expect(mockMemoryPhotosRender.mock.calls.at(-1)?.[0].media).toEqual([
      photo,
    ]);
  });
});
