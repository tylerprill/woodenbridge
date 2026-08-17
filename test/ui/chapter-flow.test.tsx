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

  it('creates a private chapter from two selected memories', async () => {
    const user = userEvent.setup();
    jest.mocked(createAtlasChapterAction).mockResolvedValue({
      ok: true,
      data: { id: 'chapter-1', version: 1, shareId: 'share-1' },
    });

    render(<ChapterEditor chapter={null} availableEntries={memories} />);

    await user.type(
      screen.getByLabelText('Chapter title'),
      'Wonders without borders',
    );
    await user.click(screen.getByRole('button', { name: 'Add Petra at dawn' }));
    await user.click(
      screen.getByRole('button', { name: 'Add Kyoto lanterns' }),
    );
    await user.click(screen.getByRole('button', { name: /Arrange & share/i }));
    await user.click(screen.getByRole('button', { name: 'Create chapter' }));

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

    await user.click(screen.getByRole('button', { name: 'Share chapter' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        'http://localhost/shared/chapters/share-1',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Unlisted chapter link copied.',
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

    await user.click(screen.getByRole('button', { name: 'Share chapter' }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: 'Wonders without borders',
        url: 'http://localhost/shared/chapters/share-1',
      }),
    );
    expect(canShare).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Chapter shared.');
  });
});
