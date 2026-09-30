/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAtlasCollectionData } from '@/app/lib/atlas/data';
import CollectionPage from '@/app/dashboard/places/page';
import LegacyCollectionRoute from '@/app/dashboard/users/page';

const mockRedirect = jest.fn();

jest.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));

jest.mock('@/app/lib/atlas/data', () => ({
  getAtlasCollectionData: jest.fn(),
}));

jest.mock('@/components/atlas/keepsake-card', () => ({
  KeepsakeCard: ({
    actions,
    entry,
    index,
  }: {
    actions?: ReactNode;
    entry: { title: string };
    index: string;
  }) => (
    <article>
      <span>{index}</span>
      <h2>{entry.title}</h2>
      {actions}
    </article>
  ),
}));

jest.mock('@/components/atlas/memory-actions', () => ({
  MemoryActionGroup: ({ children }: { children: ReactNode }) => children,
  MemoryActions: ({ returnTo }: { returnTo?: string }) =>
    returnTo ? <a href={returnTo}>Delete return target</a> : null,
}));

function collectionData(
  overrides: Partial<Awaited<ReturnType<typeof getAtlasCollectionData>>> = {},
) {
  return {
    entries: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Morning at the lake',
      },
    ],
    counts: { total: 49, visited: 30, future: 19 },
    page: 2,
    pageSize: 24,
    offset: 24,
    totalPages: 3,
    ...overrides,
  } as Awaited<ReturnType<typeof getAtlasCollectionData>>;
}

describe('Memories list route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getAtlasCollectionData).mockResolvedValue(collectionData());
  });

  it('shows every memory without the remembered and ahead filter strip', async () => {
    render(
      await CollectionPage({
        searchParams: Promise.resolve({
          view: 'ahead',
          sort: 'oldest',
          page: '2',
        }),
      }),
    );

    expect(getAtlasCollectionData).toHaveBeenCalledWith({
      filter: 'all',
      sort: 'oldest',
      page: 2,
    });
    expect(
      screen.queryByRole('navigation', { name: 'Filter memories' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('All memories')).not.toBeInTheDocument();
    expect(screen.queryByText('30 remembered')).not.toBeInTheDocument();
    expect(screen.queryByText('19 ahead')).not.toBeInTheDocument();

    expect(
      screen.getByRole('navigation', { name: 'Sort memories' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Newest' })).toHaveAttribute(
      'href',
      '/dashboard/places',
    );
    expect(screen.getByRole('link', { name: 'Oldest' })).toHaveAttribute(
      'href',
      '/dashboard/places?sort=oldest',
    );
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute(
      'href',
      '/dashboard/places?sort=oldest',
    );
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute(
      'href',
      '/dashboard/places?sort=oldest&page=3',
    );
    expect(
      screen.getByRole('link', { name: 'Delete return target' }),
    ).toHaveAttribute('href', '/dashboard/places?sort=oldest');
    expect(
      screen.getByRole('heading', { name: 'Morning at the lake' }),
    ).toBeVisible();
    expect(screen.getByText('25')).toBeVisible();
  });

  it('preserves the true empty-account welcome state', async () => {
    jest.mocked(getAtlasCollectionData).mockResolvedValue(
      collectionData({
        entries: [],
        counts: { total: 0, visited: 0, future: 0 },
        page: 1,
        offset: 0,
        totalPages: 1,
      }),
    );

    render(await CollectionPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole('heading', { name: 'Your first memory is waiting.' }),
    ).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'New memory' })).toHaveLength(2);
    for (const link of screen.getAllByRole('link', { name: 'New memory' })) {
      expect(link).toHaveAttribute('href', '/dashboard?new=memory');
    }
  });

  it('recovers an out-of-range page without restoring a legacy filter', async () => {
    jest
      .mocked(getAtlasCollectionData)
      .mockResolvedValue(collectionData({ entries: [], page: 4 }));

    render(
      await CollectionPage({
        searchParams: Promise.resolve({
          view: 'visited',
          sort: 'oldest',
          page: '4',
        }),
      }),
    );

    expect(
      screen.getByRole('heading', {
        name: 'There are no memories on this page.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Back to memories' }),
    ).toHaveAttribute('href', '/dashboard/places?sort=oldest');
  });

  it('stops forwarding legacy view filters', async () => {
    await LegacyCollectionRoute({
      searchParams: Promise.resolve({ view: 'ahead', page: '3' }),
    });

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard/places?page=3');
  });
});
