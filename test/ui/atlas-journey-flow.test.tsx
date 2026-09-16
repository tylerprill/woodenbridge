/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { AtlasData } from '@/app/lib/atlas/definitions';
import type {
  AtlasJourneyDetail,
  AtlasJourneyIndex,
} from '@/app/lib/atlas/journeys/definitions';
import { AtlasWorkspace } from '@/components/atlas/atlas-workspace';
import { AtlasJourneyBuilder } from '@/components/atlas/atlas-journey-builder';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/app/lib/actions/atlas', () => ({
  createAtlasDraftAction: jest.fn(),
  resolveAtlasPlaceAction: jest.fn(),
  saveAtlasViewAction: jest.fn(),
}));

jest.mock('@/app/lib/actions/atlas-media', () => ({
  getAtlasEntryMediaAction: jest.fn(),
}));

jest.mock('@/components/atlas/memory-photos', () => ({
  MemoryPhotos: () => <div data-testid="memory-photos">Photographs</div>,
}));

jest.mock('@/components/atlas/atlas-map-loader', () => ({
  __esModule: true,
  default: ({
    selectedJourneyStopId,
    builderSelectedEntryIds,
    onSelect,
    onJourneyStopSelect,
  }: {
    selectedJourneyStopId?: string | null;
    builderSelectedEntryIds?: string[];
    onSelect?: (id: string) => void;
    onJourneyStopSelect?: (id: string) => void;
  }) => (
    <div data-testid="atlas-map">
      <output data-testid="selected-map-stop">
        {selectedJourneyStopId ?? 'none'}
      </output>
      <output data-testid="selected-map-memories">
        {builderSelectedEntryIds?.join(',') ?? ''}
      </output>
      <button
        type="button"
        onClick={() => onSelect?.('00000000-0000-4000-8000-000000000001')}
      >
        Select first map memory
      </button>
      <button
        type="button"
        onClick={() => onSelect?.('00000000-0000-4000-8000-000000000002')}
      >
        Select second map memory
      </button>
      <button
        type="button"
        onClick={() =>
          onJourneyStopSelect?.('00000000-0000-4000-8000-000000000002')
        }
      >
        Select second map stop
      </button>
    </div>
  ),
}));

const FIRST_MEMORY_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_MEMORY_ID = '00000000-0000-4000-8000-000000000002';
const JOURNEY_ID = '00000000-0000-4000-8000-000000000010';

const initialData: AtlasData = {
  entries: [
    {
      id: FIRST_MEMORY_ID,
      title: 'Sleeping Bear sunrise',
      description: 'First light over the dune.',
      placeLabel: 'Empire, Michigan',
      placeName: 'Sleeping Bear Dunes',
      placeLocality: 'Empire',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-06-01T12:00:00.000Z',
      visitedOn: '2026-06-01',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 44.9,
      longitude: -86.0,
      version: 1,
      createdAt: '2026-06-01T12:00:00.000Z',
      updatedAt: '2026-06-01T12:00:00.000Z',
      media: [],
    },
    {
      id: SECOND_MEMORY_ID,
      title: 'Leland harbor',
      description: 'Fishtown at the end of the day.',
      placeLabel: 'Leland, Michigan',
      placeName: 'Fishtown',
      placeLocality: 'Leland',
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      placeGeocoder: 'test',
      placeGeocodedAt: '2026-06-02T12:00:00.000Z',
      visitedOn: '2026-06-02',
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 45.0,
      longitude: -85.76,
      version: 1,
      createdAt: '2026-06-02T12:00:00.000Z',
      updatedAt: '2026-06-02T12:00:00.000Z',
      media: [],
    },
  ],
  view: {
    latitude: 44.95,
    longitude: -85.88,
    zoom: 7,
    bearing: 0,
    pitch: 0,
  },
};

const journeyIndex: AtlasJourneyIndex = {
  journeys: [
    {
      id: JOURNEY_ID,
      title: 'Leelanau weekend',
      version: 1,
      updatedAt: '2026-06-03T12:00:00.000Z',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      memoryCount: 2,
      drawable: true,
      stops: [
        {
          entryId: FIRST_MEMORY_ID,
          position: 0,
          title: 'Sleeping Bear sunrise',
          placeLabel: 'Empire, Michigan',
          placeName: 'Sleeping Bear Dunes',
          visitedOn: '2026-06-01',
          latitude: 44.9,
          longitude: -86.0,
        },
        {
          entryId: SECOND_MEMORY_ID,
          position: 1,
          title: 'Leland harbor',
          placeLabel: 'Leland, Michigan',
          placeName: 'Fishtown',
          visitedOn: '2026-06-02',
          latitude: 45.0,
          longitude: -85.76,
        },
      ],
    },
  ],
  suggestions: [
    {
      key: 'a'.repeat(64),
      algorithmVersion: 1,
      source: 'atlas_history',
      reason: 'nearby_dates_and_places',
      explanation: 'These 2 memories are dated within 2 days near Leelanau.',
      suggestedTitle: 'Leelanau memories',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      memoryCount: 2,
      entryIds: [FIRST_MEMORY_ID, SECOND_MEMORY_ID],
    },
  ],
};

const journeyDetail: AtlasJourneyDetail = {
  ...journeyIndex.journeys[0],
  introduction: 'A remembered path along the lakeshore.',
  stops: journeyIndex.journeys[0].stops.map((stop) => ({
    ...stop,
    description:
      stop.entryId === FIRST_MEMORY_ID
        ? 'First light over the dune.'
        : 'Fishtown at the end of the day.',
    transitionNote: stop.position ? 'Then we followed the shoreline.' : '',
    thumbnailUrl: null,
    thumbnailAlt: '',
  })),
};

function response(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

async function openJourneyBuilder(user: ReturnType<typeof userEvent.setup>) {
  const journeys = await screen.findByRole('region', { name: 'Your journeys' });
  await user.click(
    await within(journeys).findByRole('button', { name: 'Create journey' }),
  );
}

describe('Atlas Journey Lens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((input) =>
      String(input).includes(`/${JOURNEY_ID}`)
        ? response({ journey: journeyDetail })
        : response(journeyIndex),
    );
  });

  it('keeps the Places placement tool named when its visible label is hidden', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Places' }));
    const addMemory = screen.getByRole('button', {
      name: 'Add memory',
    });
    expect(addMemory).toHaveAttribute('aria-label', 'Add memory');
    await user.click(addMemory);

    const cancelPin = screen.getByRole('button', {
      name: 'Cancel pin',
    });
    expect(cancelPin).toHaveAttribute('aria-label', 'Cancel pin');
    await user.click(cancelPin);
    expect(screen.getByRole('button', { name: 'Add memory' })).toHaveAttribute(
      'aria-label',
      'Add memory',
    );
  });

  it('opens a journey, relives it, and keeps map-stop selection in sync', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /Leelanau weekend/i }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      `/dashboard?view=journeys&journey=${JOURNEY_ID}`,
      { scroll: false },
    );

    const relive = screen.getByRole('button', { name: 'Relive' });
    const actions = relive.closest('footer');
    expect(actions).not.toBeNull();
    expect(actions?.parentElement).toHaveAttribute(
      'aria-labelledby',
      'journey-tray-title',
    );
    expect(actions).not.toContainElement(
      screen.getByRole('list', { name: 'Leelanau weekend stops' }),
    );

    await user.click(screen.getByRole('button', { name: 'Relive' }));
    expect(await screen.findByText('First light over the dune.')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Select second map stop' }),
    );

    expect(
      await screen.findByText('Fishtown at the end of the day.'),
    ).toBeVisible();
    expect(screen.getByTestId('selected-map-stop')).toHaveTextContent(
      SECOND_MEMORY_ID,
    );
  });

  it('carries reviewed suggestion context into the Chapter workshop link', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Review' }));
    const link = screen.getByRole('link', { name: 'Continue' });
    const href = link.getAttribute('href') ?? '';
    const url = new URL(href, 'https://field-atlas.test');

    expect(url.searchParams.getAll('memory')).toEqual([
      FIRST_MEMORY_ID,
      SECOND_MEMORY_ID,
    ]);
    expect(url.searchParams.get('title')).toBe('Leelanau memories');
    expect(url.searchParams.get('suggestion')).toBe('a'.repeat(64));
    expect(url.searchParams.get('suggestionSource')).toBe('atlas_history');
  });

  it('starts map-first with a collapsed list and only essential builder controls', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await openJourneyBuilder(user);

    const workspace = container.querySelector('.atlas-workspace-root');
    expect(workspace).toHaveAttribute('data-atlas-surface', 'builder');
    expect(workspace).toHaveAttribute('data-builder-list-open', 'false');
    expect(screen.getByText('0 selected')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Choose 2 more' }),
    ).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Cancel journey builder' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Back to journeys' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Explorer’s world' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Build a journey in your Atlas',
      }),
    ).toHaveClass('sr-only');
    expect(
      screen.queryByRole('toolbar', { name: 'Journey tools' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Fit memories on map' }),
    ).toBeVisible();

    const toggle = screen.getByRole('button', { name: 'Show memories' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'atlas-builder-memories');
    const list = document.getElementById('atlas-builder-memories');
    expect(list).toHaveAttribute('hidden');
    expect(list).not.toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Journey memories' }),
    ).not.toBeInTheDocument();

    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Hide memories' }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(workspace).toHaveAttribute('data-builder-list-open', 'true');
    expect(
      screen.getByRole('region', { name: 'Journey memories' }),
    ).toBeVisible();
    expect(list).not.toHaveAttribute('hidden');
  });

  it('preserves newer builder intent when the overview navigation props arrive late', async () => {
    const user = userEvent.setup();
    const props = {
      displayName: 'Explorer',
      initialData,
      initialMode: 'journeys' as const,
    };
    const { container, rerender } = render(
      <AtlasWorkspace {...props} initialJourneyId={JOURNEY_ID} />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Back to journeys' }),
    );
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Journey tools' })).getByRole(
        'button',
        { name: 'Create journey' },
      ),
    );
    await user.click(
      screen.getByRole('button', { name: 'Select second map memory' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Select first map memory' }),
    );
    await user.click(screen.getByRole('button', { name: 'Show memories' }));

    // Emulate the previously requested overview's delayed RSC payload.
    await act(async () => {
      rerender(<AtlasWorkspace {...props} initialJourneyId={null} />);
    });

    await waitFor(() =>
      expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
        'data-atlas-surface',
        'builder',
      ),
    );
    expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
      'data-builder-list-open',
      'true',
    );
    expect(
      screen.getByRole('region', { name: 'Journey memories' }),
    ).toBeVisible();
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(screen.getByTestId('selected-map-memories')).toHaveTextContent(
      `${SECOND_MEMORY_ID},${FIRST_MEMORY_ID}`,
    );
    const destination = new URL(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href') ?? '',
      'https://field-atlas.test',
    );
    expect(destination.searchParams.getAll('memory')).toEqual([
      SECOND_MEMORY_ID,
      FIRST_MEMORY_ID,
    ]);

    // A genuine browser navigation still replaces the newer local surface.
    rerender(<AtlasWorkspace {...props} initialJourneyId={JOURNEY_ID} />);
    await waitFor(() =>
      expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
        'data-atlas-surface',
        'detail',
      ),
    );
    expect(
      await screen.findByRole('button', { name: 'Back to journeys' }),
    ).toBeVisible();

    rerender(
      <AtlasWorkspace
        {...props}
        initialMode="places"
        initialJourneyId={null}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
        'data-atlas-mode',
        'places',
      ),
    );
    expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
      'data-atlas-surface',
      'overview',
    );
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('keeps map selection and Continue available while the memory list is collapsed', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await openJourneyBuilder(user);
    await user.click(
      screen.getByRole('button', { name: 'Select second map memory' }),
    );
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Choose 1 more' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Show memories' }),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.click(
      screen.getByRole('button', { name: 'Select first map memory' }),
    );

    const url = new URL(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href') ?? '',
      'https://field-atlas.test',
    );
    expect(url.searchParams.getAll('memory')).toEqual([
      SECOND_MEMORY_ID,
      FIRST_MEMORY_ID,
    ]);
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(screen.getByTestId('selected-map-memories')).toHaveTextContent(
      `${SECOND_MEMORY_ID},${FIRST_MEMORY_ID}`,
    );

    await user.click(screen.getByRole('button', { name: 'Show memories' }));
    const list = screen.getByRole('region', { name: 'Journey memories' });
    const available = within(list).getAllByRole('button', { pressed: true });
    expect(available).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Hide memories' }));
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue' })).toBeVisible();
    expect(list).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Show memories' }));
    await user.click(
      screen.getByRole('button', { name: 'Remove Leland harbor from journey' }),
    );
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Continue' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose 1 more' }),
    ).toBeDisabled();
    expect(screen.getByTestId('selected-map-memories')).toHaveTextContent(
      FIRST_MEMORY_ID,
    );
    await user.click(
      within(
        screen.getByRole('region', { name: 'Journey memories' }),
      ).getByRole('button', { name: /Leland harbor/, pressed: false }),
    );
    expect(screen.getByText('2 selected')).toBeVisible();
    const restored = new URL(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href') ?? '',
      'https://field-atlas.test',
    );
    expect(restored.searchParams.getAll('memory')).toEqual([
      FIRST_MEMORY_ID,
      SECOND_MEMORY_ID,
    ]);
  });

  it.each([false, true])(
    'focuses the opened memories region so Tab reaches its controls (selected: %s)',
    async (hasSelection) => {
      const user = userEvent.setup();
      render(
        <AtlasWorkspace
          displayName="Explorer"
          initialData={initialData}
          initialMode="journeys"
        />,
      );

      await openJourneyBuilder(user);
      if (hasSelection) {
        await user.click(
          screen.getByRole('button', { name: 'Select first map memory' }),
        );
      }
      await user.click(screen.getByRole('button', { name: 'Show memories' }));
      const memories = screen.getByRole('region', { name: 'Journey memories' });
      expect(memories).toHaveAttribute('tabindex', '0');
      await waitFor(() => expect(memories).toHaveFocus());
      const firstEnabledControl = hasSelection
        ? within(memories).getByRole('button', {
            name: 'Remove Sleeping Bear sunrise from journey',
          })
        : within(memories).getByRole('button', {
            name: /Sleeping Bear sunrise/,
            pressed: false,
          });
      expect(firstEnabledControl).toBeEnabled();

      await user.tab();
      expect(firstEnabledControl).toHaveFocus();
      expect(memories).toContainElement(document.activeElement as HTMLElement);
      expect(
        screen.getByRole('button', { name: 'Hide memories' }),
      ).not.toHaveFocus();
    },
  );

  it('preserves reviewed suggestion context and selected order when the list is collapsed again', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Review' }));
    expect(
      screen.getByRole('button', { name: 'Show memories' }),
    ).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Show memories' }));
    expect(
      screen.getByRole('button', {
        name: 'Move Sleeping Bear sunrise earlier',
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Leland harbor later' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Move Leland harbor earlier' }),
    );

    const selected = screen.getByRole('list', { name: 'Selected memories' });
    const items = within(selected).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Leland harbor');
    expect(items[1]).toHaveTextContent('Sleeping Bear sunrise');
    expect(
      screen.getByText('Leland harbor moved to position 1 of 2.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide memories' }));

    const url = new URL(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href') ?? '',
      'https://field-atlas.test',
    );
    expect(url.searchParams.getAll('memory')).toEqual([
      SECOND_MEMORY_ID,
      FIRST_MEMORY_ID,
    ]);
    expect(url.searchParams.get('source')).toBe('atlas');
    expect(url.searchParams.get('title')).toBe('Leelanau memories');
    expect(url.searchParams.get('suggestion')).toBe('a'.repeat(64));
    expect(url.searchParams.get('suggestionSource')).toBe('atlas_history');
  });

  it('opens the list with the search shortcut and collapses before cancelling on Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await openJourneyBuilder(user);
    await user.click(
      screen.getByRole('button', { name: 'Select first map memory' }),
    );
    await user.keyboard('{Control>}k{/Control}');
    const hide = screen.getByRole('button', { name: 'Hide memories' });
    const memories = screen.getByRole('region', { name: 'Journey memories' });
    await waitFor(() => expect(memories).toHaveFocus());
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(
      screen.getByRole('button', { name: 'Hide memories' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(memories).toHaveFocus());
    expect(screen.getByText('1 selected')).toBeVisible();
    await user.keyboard('{Escape}');
    const show = screen.getByRole('button', { name: 'Show memories' });
    await waitFor(() => expect(show).toHaveFocus());
    expect(screen.getByText('1 selected')).toBeVisible();
    expect(container.querySelector('.atlas-workspace-root')).toHaveAttribute(
      'data-atlas-surface',
      'builder',
    );
    await user.keyboard('{Escape}');

    expect(
      await screen.findByRole('heading', { name: 'Your journeys' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Show memories' }),
    ).not.toBeInTheDocument();
    await openJourneyBuilder(user);
    expect(screen.getByText('0 selected')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Show memories' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('cancels through its single control and restores the overview controls', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );

    await openJourneyBuilder(user);
    await user.click(screen.getByRole('button', { name: 'Show memories' }));
    await user.click(
      screen.getByRole('button', { name: 'Cancel journey builder' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Your journeys' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Explorer’s world',
    );
    expect(
      screen.getByRole('toolbar', { name: 'Journey tools' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', { name: 'Journey memories' }),
    ).not.toBeInTheDocument();
    await openJourneyBuilder(user);
    expect(
      screen.getByRole('button', { name: 'Show memories' }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('caps selection at 50 without disabling removal or Continue', async () => {
    const onToggle = jest.fn();
    const entries = Array.from({ length: 51 }, (_, index) => ({
      ...initialData.entries[0],
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: `Saved memory ${index + 1}`,
    }));
    const user = userEvent.setup();
    render(
      <AtlasJourneyBuilder
        entries={entries}
        selectedEntryIds={entries.slice(0, 50).map((entry) => entry.id)}
        listOpen
        onListOpenChange={jest.fn()}
        onToggle={onToggle}
        onMove={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText('50 selected')).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Saved memory 51/, pressed: false }),
    ).toBeDisabled();
    const selected = screen.getByRole('button', {
      name: /^Saved memory 1 /,
      pressed: true,
    });
    expect(selected).toBeEnabled();
    await user.click(selected);
    expect(onToggle).toHaveBeenCalledWith(entries[0].id);
    expect(
      screen.getByRole('button', {
        name: 'Remove Saved memory 1 from journey',
      }),
    ).toBeEnabled();
    const url = new URL(
      screen.getByRole('link', { name: 'Continue' }).getAttribute('href') ?? '',
      'https://field-atlas.test',
    );
    expect(url.searchParams.getAll('memory')).toEqual(
      entries.slice(0, 50).map((entry) => entry.id),
    );
  });

  it('returns focus to the Journey toolbar control when the panel closes', async () => {
    const user = userEvent.setup();
    render(
      <AtlasWorkspace
        displayName="Explorer"
        initialData={initialData}
        initialMode="journeys"
      />,
    );
    const close = await screen.findByRole('button', {
      name: 'Close journeys',
    });
    await user.click(close);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Open journey list' }),
      ).toHaveFocus(),
    );
  });
});
