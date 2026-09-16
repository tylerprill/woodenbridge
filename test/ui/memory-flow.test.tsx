/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  archiveAtlasEntryAction,
  updateAtlasEntryAction,
} from '@/app/lib/actions/atlas';
import type { AtlasEntry, AtlasMedia } from '@/app/lib/atlas/definitions';
import { MemoryDrawer } from '@/components/atlas/memory-drawer';

type MockMemoryPhotosProps = {
  onChange: (media: AtlasMedia[]) => void;
  onBusyChange: (busy: boolean) => void;
};

const mockMemoryPhotosRender = jest.fn<void, [MockMemoryPhotosProps]>();

jest.mock('@/app/lib/actions/atlas', () => ({
  archiveAtlasEntryAction: jest.fn(),
  updateAtlasEntryAction: jest.fn(),
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: (props: MockMemoryPhotosProps) => {
    mockMemoryPhotosRender(props);
    return <div data-testid="memory-photos">Photographs</div>;
  },
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
  beforeEach(() => {
    jest.clearAllMocks();
    delete window.__FIELD_ATLAS_NAVIGATION_GUARD__;
  });

  it.each(['draft', 'saved'] as const)(
    'renders the %s editor on a valid modal dialog element',
    (recordState) => {
      render(
        <MemoryDrawer
          entry={{ ...entry, recordState }}
          onClose={jest.fn()}
          onDirtyChange={jest.fn()}
          onUpdate={jest.fn()}
          onMediaChange={jest.fn()}
          onArchive={jest.fn()}
          mediaLoading={false}
          placeResolving={false}
        />,
      );

      const dialog = screen.getByRole('dialog', {
        name: recordState === 'draft' ? 'Create memory' : 'Edit memory',
      });
      expect(dialog.tagName).toBe('DIV');
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveStyle({
        height: '44px',
      });
      expect(dialog.matches('aside')).toBe(false);
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(dialog).toHaveAttribute(
        'aria-labelledby',
        'memory-drawer-heading',
      );
      expect(dialog).toHaveAttribute(
        'aria-describedby',
        'memory-drawer-context',
      );
      if (recordState === 'draft') {
        expect(
          screen.getByText('Draft pin saved · Finish it anytime'),
        ).toBeVisible();
        expect(
          screen.getByRole('button', { name: 'Close saved draft' }),
        ).toBeVisible();
      }
    },
  );

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
        onMediaChange={jest.fn()}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title.tagName).toBe('TEXTAREA');
    await user.type(title, saved.title);
    expect(screen.getByText('Unsaved field changes')).toBeVisible();
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

  it('keeps keyboard focus inside the modal editor and closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();

    render(
      <>
        <button type="button">Outside control</button>
        <MemoryDrawer
          entry={entry}
          onClose={onClose}
          onDirtyChange={jest.fn()}
          onUpdate={jest.fn()}
          onMediaChange={jest.fn()}
          onArchive={jest.fn()}
          mediaLoading={false}
          placeResolving={false}
        />
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create memory' });
    const close = screen.getByRole('button', { name: 'Close saved draft' });
    const save = screen.getByRole('button', { name: 'Keep memory' });
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    await waitFor(() => expect(title).toHaveFocus());
    save.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();

    screen.getByRole('button', { name: 'Outside control' }).focus();
    await waitFor(() => expect(title).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wraps reverse focus from the saved-memory heading into the drawer', async () => {
    const user = userEvent.setup();
    const savedEntry: AtlasEntry = {
      ...entry,
      title: 'Kyoto memory',
      recordState: 'saved',
    };

    render(
      <MemoryDrawer
        entry={savedEntry}
        onClose={jest.fn()}
        onDirtyChange={jest.fn()}
        onUpdate={jest.fn()}
        onMediaChange={jest.fn()}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Edit memory' });
    const remove = screen.getByRole('button', { name: 'Remove' });
    const keepsake = screen.getByRole('link', { name: 'View keepsake' });

    await waitFor(() => expect(heading).toHaveFocus());
    await user.tab({ shift: true });
    expect(remove).toHaveFocus();

    await user.tab();
    expect(keepsake).toHaveFocus();
  });

  it('routes photo-only changes separately from the current field snapshot', () => {
    const onUpdate = jest.fn();
    const onMediaChange = jest.fn();
    const photo: AtlasMedia = {
      id: 'photo-1',
      entryId: entry.id,
      mimeType: 'image/jpeg',
      width: 1200,
      height: 800,
      byteSize: 512,
      altText: 'Kyoto at dusk',
      sortOrder: 0,
      createdAt: '2026-08-17T12:00:00.000Z',
      deliveryUrl: '/api/atlas/media/photo-1',
      thumbnailUrl: '/api/atlas/media/photo-1?variant=thumbnail',
    };

    render(
      <MemoryDrawer
        entry={entry}
        onClose={jest.fn()}
        onDirtyChange={jest.fn()}
        onUpdate={onUpdate}
        onMediaChange={onMediaChange}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    const photoProps = mockMemoryPhotosRender.mock.calls.at(-1)?.[0];
    expect(photoProps).toBeDefined();
    act(() => photoProps?.onChange([photo]));

    expect(onMediaChange).toHaveBeenCalledWith(entry.id, [photo]);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('protects pending field and photo work from navigation or closing', async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const clearNavigationGuard = jest.fn();
    const setNavigationGuard = jest.fn();
    window.__FIELD_ATLAS_NAVIGATION_GUARD__ = {
      clear: clearNavigationGuard,
      set: setNavigationGuard,
    };
    let finishSave:
      | ((result: Awaited<ReturnType<typeof updateAtlasEntryAction>>) => void)
      | undefined;
    jest.mocked(updateAtlasEntryAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const { unmount } = render(
      <MemoryDrawer
        entry={entry}
        onClose={onClose}
        onDirtyChange={jest.fn()}
        onUpdate={jest.fn()}
        onMediaChange={jest.fn()}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Kyoto');
    await waitFor(() =>
      expect(setNavigationGuard).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message:
            'Leave this memory? Your unsaved field changes will be lost.',
        }),
      ),
    );
    const dirtyNavigation = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyNavigation);
    expect(dirtyNavigation.defaultPrevented).toBe(true);

    const photoProps = mockMemoryPhotosRender.mock.calls.at(-1)?.[0];
    act(() => photoProps?.onBusyChange(true));
    await waitFor(() =>
      expect(setNavigationGuard).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message:
            'Leave this memory while photo changes are still saving? They may not finish.',
        }),
      ),
    );
    expect(screen.getByText('Saving photo changes…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Keep memory' })).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Wait for photo changes before closing',
      }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', {
        name: 'Wait for photo changes before closing',
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Photo changes are still saving',
    );

    act(() => photoProps?.onBusyChange(false));
    await user.click(screen.getByRole('button', { name: 'Keep memory' }));
    await waitFor(() =>
      expect(setNavigationGuard).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message:
            'Leave this memory while it is still saving? The save may not finish.',
        }),
      ),
    );
    await act(async () => {
      finishSave?.({
        ok: true,
        data: {
          ...entry,
          title: 'Kyoto',
          recordState: 'saved',
          version: 2,
        },
      });
    });
    await waitFor(() =>
      expect(screen.getByText('Saved to your atlas')).toBeVisible(),
    );
    unmount();
    const registeredGuardId = setNavigationGuard.mock.calls.at(0)?.[0].id;
    expect(clearNavigationGuard).toHaveBeenCalledWith(registeredGuardId);
    const afterUnmount = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it('hides keepsake navigation while photo changes are saving', () => {
    render(
      <MemoryDrawer
        entry={{ ...entry, title: 'Kyoto memory', recordState: 'saved' }}
        onClose={jest.fn()}
        onDirtyChange={jest.fn()}
        onUpdate={jest.fn()}
        onMediaChange={jest.fn()}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    expect(screen.getByRole('link', { name: 'View keepsake' })).toBeVisible();
    const photoProps = mockMemoryPhotosRender.mock.calls.at(-1)?.[0];
    act(() => photoProps?.onBusyChange(true));
    expect(
      screen.queryByRole('link', { name: 'View keepsake' }),
    ).not.toBeInTheDocument();
    act(() => photoProps?.onBusyChange(false));
    expect(screen.getByRole('link', { name: 'View keepsake' })).toBeVisible();
  });

  it('recovers when removing a memory throws', async () => {
    const user = userEvent.setup();
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    jest
      .mocked(archiveAtlasEntryAction)
      .mockRejectedValue(new Error('network down'));

    render(
      <MemoryDrawer
        entry={{ ...entry, title: 'Kyoto memory', recordState: 'saved' }}
        onClose={jest.fn()}
        onDirtyChange={jest.fn()}
        onUpdate={jest.fn()}
        onMediaChange={jest.fn()}
        onArchive={jest.fn()}
        mediaLoading={false}
        placeResolving={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(
      screen.getByRole('button', { name: 'Remove this memory?' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The memory could not be removed. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    consoleError.mockRestore();
  });
});
