/**
 * @jest-environment jsdom
 */

import { act, render, screen } from '@testing-library/react';

import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import {
  ChapterMap,
  chapterMarkerGroups,
  formatChapterMapSegmentTitle,
  keepMarkersInsideFrame,
  startsChapterMapSegment,
} from '@/components/chapters/chapter-map';

const mockMapConstructor = jest.fn();
const mockEventHandlers = new Map<string, (event?: unknown) => void>();

function createMapMock() {
  return {
    addControl: jest.fn(),
    isStyleLoaded: jest.fn(() => false),
    off: jest.fn(),
    on: jest.fn((event: string, handler: (event?: unknown) => void) => {
      mockEventHandlers.set(event, handler);
    }),
    once: jest.fn(),
    remove: jest.fn(),
    resize: jest.fn(),
    setStyle: jest.fn(),
  };
}

jest.mock(
  'maplibre-gl',
  () => ({
    __esModule: true,
    Map: function MockMap(...args: unknown[]) {
      return mockMapConstructor(...args);
    },
    AttributionControl: jest.fn(),
    Popup: jest.fn(() => ({ remove: jest.fn() })),
    setWorkerUrl: jest.fn(),
  }),
  { virtual: true },
);

describe('chapter map failure recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventHandlers.clear();
    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class ResizeObserverMock {
        observe = jest.fn();
        disconnect = jest.fn();
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the chapter readable when WebGL2 initialization fails', async () => {
    mockMapConstructor.mockImplementation(() => {
      throw new Error('WebGL2 unavailable');
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <ChapterMap
        entries={[
          {
            id: 'memory-1',
            title: 'Detroit river walk',
            placeLabel: 'Detroit, Michigan',
            placeName: 'Detroit',
            latitude: 42.3314,
            longitude: -83.0458,
          },
        ]}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Route map unavailable',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(consoleError).toHaveBeenCalledWith(
      'Chapter map initialization failed:',
      expect.any(Error),
    );
  });

  it('offers recovery when the style or worker stalls asynchronously', () => {
    jest.useFakeTimers();
    const stalledMap = createMapMock();
    mockMapConstructor.mockReturnValue(stalledMap);
    const { unmount } = render(
      <ChapterMap
        entries={[
          {
            id: 'memory-1',
            title: 'Detroit river walk',
            placeLabel: 'Detroit, Michigan',
            placeName: 'Detroit',
            latitude: 42.3314,
            longitude: -83.0458,
          },
        ]}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Route map unavailable',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(
      screen.getByRole('region', { name: 'Map of 1 ordered journey memories' }),
    ).toBeInTheDocument();
    expect(stalledMap.remove).not.toHaveBeenCalled();
    unmount();
    expect(stalledMap.remove).toHaveBeenCalledTimes(1);
  });

  it('attaches error handling before applying the sanitized remote style', () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);

    render(
      <ChapterMap
        entries={[
          {
            id: 'memory-1',
            title: 'Detroit river walk',
            placeLabel: 'Detroit, Michigan',
            placeName: 'Detroit',
            latitude: 42.3314,
            longitude: -83.0458,
          },
        ]}
      />,
    );

    const constructorOptions = mockMapConstructor.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(constructorOptions).not.toHaveProperty('style');
    expect(map.setStyle).toHaveBeenCalledWith(expect.any(String), {
      transformStyle: sanitizeOpenFreeMapStyle,
    });
    const errorHandlerIndex = map.on.mock.calls.findIndex(
      ([event]) => event === 'error',
    );
    expect(errorHandlerIndex).toBeGreaterThanOrEqual(0);
    expect(map.on.mock.invocationCallOrder[errorHandlerIndex]).toBeLessThan(
      map.setStyle.mock.invocationCallOrder[0],
    );
  });

  it('removes a partially initialized map when setting its style throws', async () => {
    const map = createMapMock();
    map.setStyle.mockImplementation(() => {
      throw new Error('Style setup failed');
    });
    mockMapConstructor.mockReturnValue(map);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <ChapterMap
        entries={[
          {
            id: 'memory-1',
            title: 'Detroit river walk',
            placeLabel: 'Detroit, Michigan',
            placeName: 'Detroit',
            latitude: 42.3314,
            longitude: -83.0458,
          },
        ]}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Route map unavailable',
    );
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Chapter map initialization failed:',
      expect.any(Error),
    );
  });

  it('resets a stale edge correction before constraining a resized map', () => {
    let offset = { x: -426, y: 0 };
    const setOffset = jest.fn(([x, y]: [number, number]) => {
      offset = { x, y };
    });
    const marker = {
      getElement: () => ({
        getBoundingClientRect: () => ({
          bottom: 229 + offset.y,
          left: 147 + offset.x,
          right: 173 + offset.x,
          top: 203 + offset.y,
        }),
      }),
      getOffset: () => offset,
      setOffset,
    };
    const map = {
      getContainer: () => ({
        getBoundingClientRect: () => ({
          bottom: 432,
          left: 0,
          right: 320,
          top: 0,
        }),
      }),
    };

    keepMarkersInsideFrame(map as never, [marker as never], [[0, 0]]);
    keepMarkersInsideFrame(map as never, [marker as never], [[0, 0]]);

    expect(setOffset).toHaveBeenCalledTimes(1);
    expect(setOffset).toHaveBeenCalledWith([0, 0]);
  });

  it('spreads dense mobile stops across the full route', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    container.getBoundingClientRect = jest.fn(() => ({
      bottom: 568,
      height: 568,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
    const entries = Array.from({ length: 24 }, (_, index) => ({
      id: `memory-${index + 1}`,
      title: `Memory ${index + 1}`,
      placeLabel: 'A remembered route',
      placeName: null,
      latitude: 42,
      longitude: index,
    }));
    const map = {
      getContainer: () => container,
      project: ([longitude]: [number, number]) => ({
        x: longitude * 10,
        y: 120,
      }),
    };

    const groups = chapterMarkerGroups(map as never, entries);

    expect(groups).toEqual([
      {
        representativeIndex: 0,
        entryIndexes: [0, 1, 2, 3, 4],
      },
      {
        representativeIndex: 5,
        entryIndexes: [5, 6, 7, 8, 9],
      },
      {
        representativeIndex: 10,
        entryIndexes: [10, 11, 12, 13, 14],
      },
      {
        representativeIndex: 15,
        entryIndexes: [15, 16, 17, 18],
      },
      {
        representativeIndex: 23,
        entryIndexes: [19, 20, 21, 22, 23],
      },
    ]);
    expect(groups.flatMap((group) => group.entryIndexes)).toEqual(
      entries.map((_, index) => index),
    );
  });

  it('anchors groups at both spatial extremes when reading order doubles back', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    const projectedX = [24, 0, 12, 120, 96, 108, 192, 216, 204];
    const entries = projectedX.map((longitude, index) => ({
      id: `memory-${index + 1}`,
      title: `Memory ${index + 1}`,
      placeLabel: 'A remembered route',
      placeName: null,
      latitude: 42,
      longitude,
    }));
    const map = {
      getContainer: () => container,
      project: ([longitude]: [number, number]) => ({ x: longitude, y: 100 }),
    };

    const groups = chapterMarkerGroups(map as never, entries);

    expect(groups).toEqual([
      { representativeIndex: 1, entryIndexes: [0, 1, 2] },
      { representativeIndex: 3, entryIndexes: [3, 4, 5] },
      { representativeIndex: 7, entryIndexes: [6, 7, 8] },
    ]);
    const representativeX = groups.map(
      (group) => projectedX[group.representativeIndex],
    );
    expect(Math.min(...representativeX)).toBe(Math.min(...projectedX));
    expect(Math.max(...representativeX)).toBe(Math.max(...projectedX));
    representativeX.forEach((first, firstIndex) => {
      representativeX.slice(firstIndex + 1).forEach((second) => {
        expect(Math.abs(first - second)).toBeGreaterThan(48);
      });
    });
  });

  it('keeps both visible ends when chronological endpoints coincide', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    const projectedX = [50, 0, 50, 100, 50];
    const entries = projectedX.map((longitude, index) => ({
      id: `memory-${index + 1}`,
      title: `Memory ${index + 1}`,
      placeLabel: 'An out-and-back route',
      placeName: null,
      latitude: 42,
      longitude,
    }));
    const map = {
      getContainer: () => container,
      project: ([longitude]: [number, number]) => ({ x: longitude, y: 100 }),
    };

    const groups = chapterMarkerGroups(map as never, entries);
    const representativeX = groups.map(
      (group) => projectedX[group.representativeIndex],
    );

    expect(representativeX).toEqual(expect.arrayContaining([0, 100]));
    expect(groups.flatMap((group) => group.entryIndexes).sort()).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('starts a new tooltip heading for distinct segments with duplicate titles', () => {
    const entries = [
      {
        id: 'memory-1',
        title: 'First memory',
        placeLabel: 'Somewhere',
        placeName: null,
        latitude: 40,
        longitude: -105,
        segmentId: 'segment-a',
        segmentTitle: 'Travel day',
      },
      {
        id: 'memory-2',
        title: 'Second memory',
        placeLabel: 'Somewhere',
        placeName: null,
        latitude: 41,
        longitude: -104,
        segmentId: 'segment-b',
        segmentTitle: 'Travel day',
      },
    ];

    expect(startsChapterMapSegment(entries, 0)).toBe(true);
    expect(startsChapterMapSegment(entries, 1)).toBe(true);
  });

  it('normalizes tooltip segment titles with one trailing colon', () => {
    expect(formatChapterMapSegmentTitle('  Day 3 · High Plains  ')).toBe(
      'Day 3 · High Plains:',
    );
    expect(formatChapterMapSegmentTitle('Day 4:')).toBe('Day 4:');
    expect(formatChapterMapSegmentTitle('   ')).toBeNull();
  });

  it('uses a tighter grouping distance on phone maps', () => {
    const container = document.createElement('div');
    const project = ([longitude]: [number, number]) => ({
      x: longitude,
      y: 100,
    });
    const entries = [0, 50, 100].map((longitude, index) => ({
      id: `memory-${index + 1}`,
      title: `Memory ${index + 1}`,
      placeLabel: 'A remembered route',
      placeName: null,
      latitude: 42,
      longitude,
    }));
    const map = { getContainer: () => container, project };

    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    expect(chapterMarkerGroups(map as never, entries)).toHaveLength(3);

    Object.defineProperty(container, 'clientWidth', {
      configurable: true,
      value: 900,
    });
    expect(chapterMarkerGroups(map as never, entries)).toHaveLength(2);
  });
});
