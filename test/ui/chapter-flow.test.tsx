/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  createAtlasChapterAction,
  deleteAtlasChapterAction,
  updateAtlasChapterAction,
} from '@/app/lib/actions/chapters';
import type {
  AtlasChapterEditorChapter,
  AtlasChapterMemoryOption,
  ChapterActionResult,
} from '@/app/lib/chapters/definitions';
import { ChapterEditor } from '@/components/chapters/chapter-editor';
import { ChapterShareControl } from '@/components/chapters/chapter-share-control';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    unoptimized?: boolean;
  }) => <img alt={alt ?? ''} {...props} />,
}));

jest.mock('@/app/lib/actions/chapters', () => ({
  createAtlasChapterAction: jest.fn(),
  deleteAtlasChapterAction: jest.fn(),
  updateAtlasChapterAction: jest.fn(),
}));

const memories: AtlasChapterMemoryOption[] = [
  {
    id: 'memory-1',
    title: 'Petra at dawn',
    placeLabel: 'Petra, Jordan',
    placeName: 'Petra',
    visitedOn: '2026-01-03',
    journeyState: 'visited',
    coverMediaId: null,
    thumbnailUrl: null,
  },
  {
    id: 'memory-2',
    title: 'Kyoto lanterns',
    placeLabel: 'Kyoto, Japan',
    placeName: 'Kyoto',
    visitedOn: '2026-02-12',
    journeyState: 'visited',
    coverMediaId: null,
    thumbnailUrl: null,
  },
];

const existingJourney: AtlasChapterEditorChapter = {
  id: 'c202ab58-61c3-455d-8cee-6bd9f29a7e94',
  title: 'Wonders without borders',
  introduction: 'Two places held together.',
  version: 4,
  coverMediaId: null,
  visibility: 'private',
  shareId: '95e54d0c-d3f6-4f5c-aa65-92e006469efd',
  shareMap: true,
  shareLocationPrecision: 'approximate',
  memories: memories.map((memory) => ({
    entryId: memory.id,
    transitionNote: '',
  })),
};

describe('chapter creation and sharing UI', () => {
  beforeEach(() => {
    mockPush.mockReset();
    jest.mocked(createAtlasChapterAction).mockReset();
    jest.mocked(deleteAtlasChapterAction).mockReset();
    jest.mocked(updateAtlasChapterAction).mockReset();
  });

  it('uses Journey naming in the workshop and private sharing controls', () => {
    const { container, unmount } = render(
      <ChapterEditor chapter={null} availableEntries={memories} />,
    );

    expect(
      screen.getByRole('heading', { name: 'Begin a new journey.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Journey workshop')).toBeInTheDocument();
    expect(screen.getByLabelText('Journey title')).toBeInTheDocument();
    expect(screen.getByLabelText('Journey introduction')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Journeys' })).toHaveAttribute(
      'href',
      '/dashboard/chapters',
    );
    expect(container.textContent).not.toMatch(/\bchapters?\b/i);
    unmount();

    render(
      <ChapterShareControl
        chapterId="chapter-1"
        chapterTitle="Chapter one of our travels"
        shareId="share-1"
        visibility="private"
      />,
    );
    expect(screen.getByRole('link', { name: 'Share journey' })).toHaveAttribute(
      'href',
      '/dashboard/chapters/chapter-1/edit?step=arrange#chapter-sharing-heading',
    );
  });

  it('keeps memory and transition rows as semantic list items in a ten-stop route', async () => {
    const user = userEvent.setup();
    const tenMemories = Array.from({ length: 10 }, (_, index) => ({
      ...memories[index % memories.length],
      id: `memory-${index + 1}`,
      title: `Stop ${index + 1}`,
    }));
    render(
      <ChapterEditor
        chapter={null}
        availableEntries={tenMemories}
        initialMemoryIds={tenMemories.map((memory) => memory.id)}
        initialTitle="Ten stops together"
        initialStep="arrange"
      />,
    );

    const route = screen.getByRole('list');
    expect(route.tagName).toBe('OL');
    expect(route.children).toHaveLength(19);
    for (const row of Array.from(route.children)) {
      expect(row.tagName).toBe('LI');
      expect(row).not.toHaveAttribute('role', 'presentation');
      expect(row).not.toHaveAttribute('role', 'none');
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(19);

    await user.click(
      screen.getAllByRole('button', {
        name: 'Add words between these stops',
      })[0],
    );
    expect(
      screen.getByRole('textbox', { name: /^Words between Stop 1 and Stop 2/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(19);

    await user.click(
      screen.getByRole('button', { name: 'Move Stop 2 earlier' }),
    );
    expect(route.children[0]).toHaveTextContent('Stop 2');
    expect(route.children[2]).toHaveTextContent('Stop 1');
    expect(screen.getAllByRole('listitem')).toHaveLength(19);
  });

  it('creates a private chapter from two selected memories', async () => {
    const user = userEvent.setup();
    jest.mocked(createAtlasChapterAction).mockResolvedValue({
      ok: true,
      data: { id: 'chapter-1', version: 1, shareId: 'share-1' },
    });

    render(<ChapterEditor chapter={null} availableEntries={memories} />);

    await user.type(
      screen.getByLabelText('Journey title'),
      'Wonders without borders',
    );
    await user.click(screen.getByRole('button', { name: 'Add Petra at dawn' }));
    await user.click(
      screen.getByRole('button', { name: 'Add Kyoto lanterns' }),
    );
    await user.click(screen.getByRole('button', { name: /Arrange & share/i }));
    await user.click(screen.getByRole('button', { name: 'Create journey' }));

    await waitFor(() =>
      expect(createAtlasChapterAction).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Wonders without borders',
          visibility: 'private',
          memories: [
            { entryId: 'memory-1', transitionNote: '' },
            { entryId: 'memory-2', transitionNote: '' },
          ],
        }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/dashboard/chapters/chapter-1?saved=created',
    );
  });

  it('keeps a deep-linked Atlas selection in order and returns to Journey Lens', async () => {
    const user = userEvent.setup();
    jest.mocked(createAtlasChapterAction).mockResolvedValue({
      ok: true,
      data: { id: 'chapter-1', version: 1, shareId: 'share-1' },
    });

    render(
      <ChapterEditor
        chapter={null}
        availableEntries={memories}
        initialMemoryIds={['memory-2', 'memory-1']}
        source="atlas"
      />,
    );

    expect(screen.getByRole('link', { name: 'Back to Atlas' })).toHaveAttribute(
      'href',
      '/dashboard?view=journeys',
    );
    expect(screen.getByText(/memories selected/)).toHaveTextContent(
      /02\s*memories selected/,
    );
    await user.type(screen.getByLabelText('Journey title'), 'Across the map');
    await user.click(screen.getByRole('button', { name: /Arrange & share/i }));
    await user.click(screen.getByRole('button', { name: 'Create journey' }));

    await waitFor(() =>
      expect(createAtlasChapterAction).toHaveBeenCalledWith(
        expect.objectContaining({
          memories: [
            { entryId: 'memory-2', transitionNote: '' },
            { entryId: 'memory-1', transitionNote: '' },
          ],
        }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith(
      '/dashboard?view=journeys&journey=chapter-1',
    );
  });

  it('protects primary navigation but leaves modified and non-primary link gestures alone', async () => {
    const user = userEvent.setup();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ChapterEditor chapter={null} availableEntries={memories} />);

    await user.type(screen.getByLabelText('Journey title'), 'A new route');
    const backLink = screen.getByRole('link', { name: 'My Journeys' });
    backLink.addEventListener('click', (event) => event.preventDefault());

    fireEvent.click(backLink, { button: 0, metaKey: true });
    fireEvent.click(backLink, { button: 0, ctrlKey: true });
    fireEvent.click(backLink, { button: 1 });
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.click(backLink, { button: 0 });
    expect(confirm).toHaveBeenCalledWith(
      'Leave this journey? Your unsaved changes will be lost.',
    );
    confirm.mockRestore();
  });

  it('registers and retires the browser-history guard with the dirty state', async () => {
    const user = userEvent.setup();
    const clear = jest.fn();
    const set = jest.fn();
    window.__FIELD_ATLAS_NAVIGATION_GUARD__ = { clear, set };
    const { unmount } = render(
      <ChapterEditor chapter={null} availableEntries={memories} />,
    );
    await user.type(screen.getByLabelText('Journey title'), 'A guarded route');

    await waitFor(() =>
      expect(set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message: 'Leave this journey? Your unsaved changes will be lost.',
          onLeave: expect.any(Function),
        }),
      ),
    );

    await user.clear(screen.getByLabelText('Journey title'));
    await waitFor(() => expect(clear).toHaveBeenCalled());
    expect(clear.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      set.mock.invocationCallOrder.at(-1) ?? 0,
    );

    unmount();
    delete window.__FIELD_ATLAS_NAVIGATION_GUARD__;
  });

  it('keeps the leave guard active during save without blocking the successful redirect', async () => {
    const user = userEvent.setup();
    let finishSave:
      | ((
          result: ChapterActionResult<{
            id: string;
            version: number;
            shareId: string;
          }>,
        ) => void)
      | undefined;
    jest.mocked(updateAtlasChapterAction).mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <ChapterEditor chapter={existingJourney} availableEntries={memories} />,
    );

    const title = screen.getByLabelText('Journey title');
    await user.clear(title);
    await user.type(title, 'Wonders, newly remembered');
    await user.click(screen.getByRole('button', { name: /Arrange & share/i }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Saving journey…' }),
      ).toHaveAttribute('aria-busy', 'true'),
    );

    fireEvent.click(screen.getByRole('link', { name: 'Back to journey' }));
    expect(confirm).toHaveBeenCalledWith(
      'Leave this journey while it is still saving? The save may not finish.',
    );

    finishSave?.({
      ok: true,
      data: {
        id: existingJourney.id,
        version: existingJourney.version + 1,
        shareId: existingJourney.shareId,
      },
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        `/dashboard/chapters/${existingJourney.id}?saved=updated`,
      ),
    );
    confirm.mockRestore();
  });

  it('keeps an accepted pending-save departure from being replaced by the save redirect', async () => {
    const user = userEvent.setup();
    let finishSave:
      | ((
          result: ChapterActionResult<{
            id: string;
            version: number;
            shareId: string;
          }>,
        ) => void)
      | undefined;
    jest.mocked(updateAtlasChapterAction).mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ChapterEditor chapter={existingJourney} availableEntries={memories} />,
    );

    const title = screen.getByLabelText('Journey title');
    await user.clear(title);
    await user.type(title, 'Wonders, briefly remembered');
    await user.click(screen.getByRole('button', { name: /Arrange & share/i }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Saving journey…' }),
      ).toHaveAttribute('aria-busy', 'true'),
    );

    fireEvent.click(screen.getByRole('link', { name: 'Back to journey' }));
    expect(mockPush).toHaveBeenCalledWith(
      `/dashboard/chapters/${existingJourney.id}`,
    );

    finishSave?.({
      ok: true,
      data: {
        id: existingJourney.id,
        version: existingJourney.version + 1,
        shareId: existingJourney.shareId,
      },
    });
    await waitFor(() => expect(updateAtlasChapterAction).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('uses a focused, escapable confirmation before deleting the reviewed version', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteAtlasChapterAction).mockResolvedValue({
      ok: true,
      data: { id: existingJourney.id },
    });
    render(
      <ChapterEditor
        chapter={existingJourney}
        availableEntries={memories}
        initialStep="arrange"
      />,
    );

    const deleteTrigger = screen.getByRole('button', {
      name: 'Delete journey',
    });
    await user.click(deleteTrigger);
    let confirmation = screen.getByRole('alertdialog', {
      name: 'Delete this journey?',
    });
    expect(
      within(confirmation).getByRole('button', { name: 'Keep journey' }),
    ).toHaveFocus();
    expect(
      within(confirmation).getByRole('button', {
        name: 'Delete journey permanently',
      }),
    ).not.toBe(deleteTrigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    const restoredDeleteTrigger = screen.getByRole('button', {
      name: 'Delete journey',
    });
    await waitFor(() => expect(restoredDeleteTrigger).toHaveFocus());

    await user.click(restoredDeleteTrigger);
    confirmation = screen.getByRole('alertdialog', {
      name: 'Delete this journey?',
    });
    await user.click(
      within(confirmation).getByRole('button', {
        name: 'Delete journey permanently',
      }),
    );

    await waitFor(() =>
      expect(deleteAtlasChapterAction).toHaveBeenCalledWith({
        id: existingJourney.id,
        version: existingJourney.version,
      }),
    );
    expect(mockPush).toHaveBeenCalledWith('/dashboard/chapters');
  });

  it('keeps a stale journey when versioned deletion reports a conflict', async () => {
    const user = userEvent.setup();
    jest.mocked(deleteAtlasChapterAction).mockResolvedValue({
      ok: false,
      error: 'conflict',
      message: 'This journey changed elsewhere. Refresh it before deleting.',
    });
    render(
      <ChapterEditor
        chapter={existingJourney}
        availableEntries={memories}
        initialStep="arrange"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete journey' }));
    await user.click(
      screen.getByRole('button', { name: 'Delete journey permanently' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A newer version is already saved.');
    expect(alert).toHaveTextContent(
      'This journey changed elsewhere. Refresh it before deleting.',
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('copies an unlisted link with accurate feedback', async () => {
    const user = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });

    render(
      <ChapterShareControl
        chapterId="chapter-1"
        chapterTitle="Wonders without borders"
        shareId="share-1"
        visibility="shared"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Share journey' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'http://localhost/shared/chapters/share-1',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Unlisted journey link copied.',
    );
  });

  it('uses the native share sheet when the browser supports it', async () => {
    const user = userEvent.setup();
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: share,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: canShare,
    });

    render(
      <ChapterShareControl
        chapterId="chapter-1"
        chapterTitle="Wonders without borders"
        shareId="share-1"
        visibility="shared"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Share journey' }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: 'Wonders without borders',
        url: 'http://localhost/shared/chapters/share-1',
      }),
    );
    expect(canShare).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Journey shared.');
  });
});
