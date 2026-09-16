/**
 * @jest-environment jsdom
 */

/* eslint-disable @next/next/no-img-element */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createAtlasChapterAction } from '@/app/lib/actions/chapters';
import type { AtlasChapterMemoryOption } from '@/app/lib/chapters/definitions';
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

describe('chapter creation and sharing UI', () => {
  beforeEach(() => {
    mockPush.mockReset();
    jest.mocked(createAtlasChapterAction).mockReset();
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
