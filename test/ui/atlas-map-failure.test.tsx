/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import type { AtlasView } from '@/app/lib/atlas/definitions';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import AtlasMap from '@/components/atlas/atlas-map';

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
    ScaleControl: jest.fn(),
    LngLatBounds: jest.fn(),
    setWorkerUrl: jest.fn(),
  }),
  { virtual: true },
);

const initialView: AtlasView = {
  latitude: 22,
  longitude: -18,
  zoom: 1.65,
  bearing: 0,
  pitch: 0,
};

function createMapMock() {
  const canvas = document.createElement('canvas');
  return {
    keyboard: { disableRotation: jest.fn() },
    touchZoomRotate: { disableRotation: jest.fn() },
    addControl: jest.fn(),
    setStyle: jest.fn(),
    getCanvas: jest.fn(() => canvas),
    on: jest.fn((event: string, ...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === 'function') {
        mockEventHandlers.set(event, args[0] as (event?: unknown) => void);
      }
    }),
    remove: jest.fn(),
    resize: jest.fn(),
  };
}

function renderMap(view = initialView) {
  return render(
    <AtlasMap
      entries={[]}
      initialView={view}
      interactionLocked={false}
      selectedId={null}
      placementMode={false}
      focusRequest={{ id: null, nonce: 0 }}
      fitRequest={1}
      onSelect={jest.fn()}
      onPlace={jest.fn()}
      onViewChange={jest.fn()}
    />,
  );
}

describe('Atlas map failure recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventHandlers.clear();
    mockMapConstructor.mockImplementation(() => createMapMock());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps the route alive when a mobile WebGL context cannot be created', async () => {
    mockMapConstructor.mockImplementationOnce(() => {
      throw new Error('WebGL context unavailable');
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    renderMap();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The map is taking the long way around.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(consoleError).toHaveBeenCalledWith(
      'Atlas map initialization failed:',
      expect.any(Error),
    );
  });

  it('does not recreate the location map when its controlled view changes', () => {
    const { rerender } = renderMap();

    rerender(
      <AtlasMap
        entries={[]}
        initialView={{ ...initialView, latitude: 35, longitude: 135 }}
        interactionLocked={false}
        selectedId={null}
        placementMode
        focusRequest={{ id: null, nonce: 0 }}
        fitRequest={0}
        onSelect={jest.fn()}
        onPlace={jest.fn()}
        onViewChange={jest.fn()}
      />,
    );

    expect(mockMapConstructor).toHaveBeenCalledTimes(1);
  });

  it('attaches error handling before applying the sanitized remote style', () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);

    renderMap();

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

    renderMap();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The map is taking the long way around.',
    );
    expect(map.remove).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      'Atlas map initialization failed:',
      expect.any(Error),
    );
  });

  it('allows transient source and tile errors to recover while loading', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    renderMap();

    act(() => {
      mockEventHandlers.get('error')?.({ error: new Error('Tile timed out') });
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      'Atlas map error:',
      expect.any(Error),
    );
  });

  it('times out a stalled load and recreates the map on retry', () => {
    jest.useFakeTimers();
    const firstMap = createMapMock();
    mockMapConstructor
      .mockImplementationOnce(() => firstMap)
      .mockImplementation(() => createMapMock());
    const { unmount } = renderMap();

    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(firstMap.remove).toHaveBeenCalledTimes(1);
    expect(mockMapConstructor).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    unmount();
  });
});
