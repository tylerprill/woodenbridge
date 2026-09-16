/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import {
  getAtlasChapterEditorData,
  getAtlasChapters,
} from '@/app/lib/chapters/data';
import ChaptersPage from '@/app/dashboard/chapters/page';
import NewChapterPage from '@/app/dashboard/chapters/new/page';

jest.mock('@/app/lib/chapters/data', () => ({
  getAtlasChapterEditorData: jest.fn(),
  getAtlasChapters: jest.fn(),
}));

jest.mock('@/components/chapters/chapter-card', () => ({
  ChapterCard: ({
    chapter,
    index,
  }: {
    chapter: { title: string };
    index: string;
  }) => (
    <article>
      <h2>{chapter.title}</h2>
      <span>{index}</span>
    </article>
  ),
}));

jest.mock('@/components/chapters/chapter-editor', () => ({
  ChapterEditor: ({
    availableEntries,
  }: {
    availableEntries: Array<{ id: string }>;
  }) => (
    <div data-testid="chapter-editor">
      {availableEntries.length} memories available
    </div>
  ),
}));

const memory = (id: string) => ({
  id,
  title: `Memory ${id}`,
  placeLabel: 'Ann Arbor, Michigan',
  placeName: 'Ann Arbor',
  visitedOn: '2026-09-15',
  journeyState: 'visited' as const,
  coverMediaId: null,
  thumbnailUrl: null,
});

describe('Journey empty-state routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses one focused call to action and omits a zero counter for an empty library', async () => {
    jest.mocked(getAtlasChapters).mockResolvedValue({
      chapters: [],
      total: 0,
      availableMemoryCount: 0,
      page: 1,
      pageSize: 18,
      offset: 0,
      totalPages: 1,
    });

    render(
      await ChaptersPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole('heading', { name: 'Start with two memories.' }),
    ).toBeInTheDocument();
    const actions = screen.getAllByRole('link', { name: 'Add memories' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAttribute('href', '/dashboard/import');
    expect(screen.queryByText(/0+\s*journeys/i)).not.toBeInTheDocument();
  });

  it('leaves the populated library header and creation path intact', async () => {
    jest.mocked(getAtlasChapters).mockResolvedValue({
      chapters: [
        {
          id: 'journey-1',
          title: 'A remembered road',
          introduction: 'Two places held together.',
          version: 1,
          memoryCount: 2,
          startDate: '2025-09-15',
          endDate: '2026-09-15',
          coverMedia: null,
          coverMediaId: null,
          visibility: 'private',
          shareId: 'share-1',
          shareMap: true,
          shareLocationPrecision: 'approximate',
          createdAt: '2026-09-15T12:00:00.000Z',
          updatedAt: '2026-09-15T12:00:00.000Z',
        },
      ],
      total: 1,
      availableMemoryCount: 2,
      page: 1,
      pageSize: 18,
      offset: 0,
      totalPages: 1,
    });

    render(
      await ChaptersPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText('journey')).toHaveTextContent(/01\s*journey/);
    expect(screen.getByRole('link', { name: 'New journey' })).toHaveAttribute(
      'href',
      '/dashboard/chapters/new',
    );
    expect(
      screen.getByRole('heading', { name: 'A remembered road' }),
    ).toBeInTheDocument();
  });

  it('gates a direct workshop visit before rendering editor chrome', async () => {
    jest.mocked(getAtlasChapterEditorData).mockResolvedValue({
      chapter: null,
      availableEntries: [memory('one')],
    });

    render(
      await NewChapterPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'Your journey needs memories first.',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('chapter-editor')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload photos' })).toHaveAttribute(
      'href',
      '/dashboard/import',
    );
    expect(
      screen.getByRole('link', { name: 'Open your atlas' }),
    ).toHaveAttribute('href', '/dashboard');
  });

  it('renders the unchanged editor once two memories are available', async () => {
    jest.mocked(getAtlasChapterEditorData).mockResolvedValue({
      chapter: null,
      availableEntries: [memory('one'), memory('two')],
    });

    render(
      await NewChapterPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByTestId('chapter-editor')).toHaveTextContent(
      '2 memories available',
    );
    expect(
      screen.queryByRole('heading', {
        name: 'Your journey needs memories first.',
      }),
    ).not.toBeInTheDocument();
  });
});
