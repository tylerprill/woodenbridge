/**
 * @jest-environment jsdom
 */

import { act, render, screen } from '@testing-library/react';

import {
  ChapterMap,
  keepMarkersInsideFrame,
} from '@/components/chapters/chapter-map';

const mockMapConstructor = jest.fn();
const mockEventHandlers = new Map<string, (event?: unknown) => void>();

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
    const stalledMap = {
      addControl: jest.fn(),
      isStyleLoaded: jest.fn(() => false),
      off: jest.fn(),
      on: jest.fn((event: string, handler: (event?: unknown) => void) => {
        mockEventHandlers.set(event, handler);
      }),
      once: jest.fn(),
      remove: jest.fn(),
      resize: jest.fn(),
    };
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
