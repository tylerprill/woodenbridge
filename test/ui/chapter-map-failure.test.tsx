/**
 * @jest-environment jsdom
 */

import { act, render, screen } from '@testing-library/react';

import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import {
  ChapterMap,
  keepMarkersInsideFrame,
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
      screen.getByRole('region', { name: 'Map of 1 ordered chapter memories' }),
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
});
