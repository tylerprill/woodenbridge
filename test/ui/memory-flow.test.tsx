/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { updateAtlasEntryAction } from '@/app/lib/actions/atlas';
import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import { MemoryDrawer } from '@/components/atlas/memory-drawer';

jest.mock('@/app/lib/actions/atlas', () => ({
  archiveAtlasEntryAction: jest.fn(),
  updateAtlasEntryAction: jest.fn(),
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: () => <div data-testid="memory-photos">Photographs</div>,
}));

const entry: AtlasEntry = {
  id: 'memory-1',
  title: '',
  description: '',
  placeLabel: 'Kyoto, Japan',
  placeName: 'Kyoto',
  placeLocality: 'Kyoto',
  placeRegion: 'Kyoto',
  placeCountry: 'Japan',
  placeCountryCode: 'JP',
  placeGeocoder: 'test',
  placeGeocodedAt: '2026-08-17T12:00:00.000Z',
  visitedOn: null,
  recordState: 'draft',
  journeyState: 'visited',
  latitude: 35.0116,
  longitude: 135.7681,
  version: 1,
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
  media: [],
};

describe('memory capture UI', () => {
  it('uses a growing title field and explicitly saves the complete memory', async () => {
    const user = userEvent.setup();
    const onUpdate = jest.fn();
    const saved = {
      ...entry,
      title: 'A very long title that deserves room to breathe',
      recordState: 'saved' as const,
      version: 2,
    };
    jest.mocked(updateAtlasEntryAction).mockResolvedValue({
      ok: true,
      data: saved,
    });

    render(
      <MemoryDrawer
        entry={entry}
        onClose={jest.fn()}
        onDirtyChange={jest.fn()}
        onUpdate={onUpdate}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title.tagName).toBe('TEXTAREA');
    await user.type(title, saved.title);
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Keep memory' }));

    await waitFor(() =>
      expect(updateAtlasEntryAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: entry.id,
          title: saved.title,
          placeLabel: 'Kyoto, Japan',
        }),
      ),
    );
    expect(onUpdate).toHaveBeenCalledWith(saved);
  });
});
