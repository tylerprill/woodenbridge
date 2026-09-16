/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import ChaptersLoading from '@/app/dashboard/chapters/loading';
import { getSharedAtlasChapter } from '@/app/lib/chapters/data';
import type { SharedAtlasChapter } from '@/app/lib/chapters/definitions';
import SharedChapterLoading from '@/app/shared/chapters/[shareId]/loading';
import SharedChapterUnavailable from '@/app/shared/chapters/[shareId]/not-found';
import { generateMetadata } from '@/app/shared/chapters/[shareId]/page';

jest.mock('@/app/lib/chapters/data', () => ({
  getSharedAtlasChapter: jest.fn(),
}));

jest.mock('@/components/chapters/chapter-reader', () => ({
  ChapterReader: () => null,
}));

const chapter: SharedAtlasChapter = {
  id: 'chapter-1',
  title: 'Chapter one: across the sea',
  introduction: '',
  version: 1,
  memoryCount: 2,
  startDate: '2025-09-15',
  endDate: '2025-09-20',
  coverMedia: null,
  coverMediaId: null,
  visibility: 'shared',
  shareId: 'share-1',
  shareMap: true,
  shareLocationPrecision: 'approximate',
  createdAt: '2025-09-20T00:00:00.000Z',
  updatedAt: '2025-09-20T00:00:00.000Z',
  entries: [],
};

describe('Journey route naming', () => {
  beforeEach(() => {
    jest.mocked(getSharedAtlasChapter).mockReset();
  });

  it('uses Journey naming in metadata for an unavailable share', async () => {
    jest.mocked(getSharedAtlasChapter).mockResolvedValue(null);

    await expect(
      generateMetadata({ params: Promise.resolve({ shareId: 'missing' }) }),
    ).resolves.toEqual({ title: 'Shared journey | Field Atlas' });
  });

  it('uses a Journey fallback while preserving the authored title and privacy', async () => {
    jest.mocked(getSharedAtlasChapter).mockResolvedValue(chapter);

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: chapter.shareId }),
    });

    expect(metadata.title).toBe('Chapter one: across the sea | Field Atlas');
    expect(metadata.description).toBe('A Field Atlas journey with 2 memories.');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph).toEqual(
      expect.objectContaining({
        title: chapter.title,
        description: 'A Field Atlas journey with 2 memories.',
        url: expect.any(URL),
      }),
    );
    expect(metadata.twitter).toEqual(
      expect.objectContaining({
        title: chapter.title,
        description: 'A Field Atlas journey with 2 memories.',
      }),
    );
    const openGraph = metadata.openGraph as { url: URL };
    expect(openGraph.url.pathname).toBe('/shared/chapters/share-1');
  });

  it('preserves chapter wording in an author’s social description', async () => {
    const introduction = 'A chapter we will always remember.';
    jest.mocked(getSharedAtlasChapter).mockResolvedValue({
      ...chapter,
      introduction,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ shareId: chapter.shareId }),
    });

    expect(metadata.description).toBe(introduction);
  });

  it('uses Journey naming in both loading states', () => {
    const { container, unmount } = render(<ChaptersLoading />);
    expect(screen.getByText('My Journeys')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bchapters?\b/i);
    unmount();

    render(<SharedChapterLoading />);
    expect(screen.getByRole('status')).toHaveTextContent('Shared journey');
    expect(
      screen.getByRole('heading', { name: 'Unfolding the journey…' }),
    ).toBeInTheDocument();
  });

  it('uses Journey naming in the privacy-preserving unavailable page', () => {
    const { container } = render(<SharedChapterUnavailable />);

    expect(screen.getByText('Journey unavailable')).toBeInTheDocument();
    expect(screen.getByText(/The journey may be private/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bchapters?\b/i);
  });
});
