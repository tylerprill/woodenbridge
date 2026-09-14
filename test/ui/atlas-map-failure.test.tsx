/**
 * @jest-environment jsdom
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import AtlasMap from '@/components/atlas/atlas-map';

const mockMapConstructor = jest.fn();
const mockEventHandlers = new Map<string, (event?: unknown) => void>();
const mockMarkerElements: HTMLButtonElement[] = [];

jest.mock(
  'maplibre-gl',
  () => ({
    __esModule: true,
    Map: function MockMap(...args: unknown[]) {
      return mockMapConstructor(...args);
    },
    AttributionControl: jest.fn(),
    ScaleControl: jest.fn(),
    LngLatBounds: function MockLngLatBounds() {
      const bounds = { extend: jest.fn() };
      bounds.extend.mockReturnValue(bounds);
      return bounds;
    },
    Marker: function MockMarker({ element }: { element: HTMLButtonElement }) {
      mockMarkerElements.push(element);
      const marker = {
        addTo: jest.fn(),
        getElement: jest.fn(() => element),
        remove: jest.fn(),
        setLngLat: jest.fn(),
      };
      marker.addTo.mockReturnValue(marker);
      marker.setLngLat.mockReturnValue(marker);
      return marker;
    },
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
  const container = document.createElement('div');
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 752 },
    clientWidth: { configurable: true, value: 1000 },
  });
  let padding = { top: 0, right: 0, bottom: 0, left: 0 };
  const easeTo = jest.fn((options: { padding?: typeof padding } = {}) => {
    if (options.padding) padding = options.padding;
  });
  const setPadding = jest.fn((nextPadding: typeof padding) => {
    padding = nextPadding;
  });
  return {
    keyboard: { disableRotation: jest.fn() },
    touchZoomRotate: { disableRotation: jest.fn() },
    addControl: jest.fn(),
    addLayer: jest.fn(),
    addSource: jest.fn(),
    easeTo,
    fitBounds: jest.fn(),
    getBearing: jest.fn(() => 0),
    setStyle: jest.fn(),
    getCanvas: jest.fn(() => canvas),
    getContainer: jest.fn(() => container),
    getLayer: jest.fn(() => undefined),
    getPitch: jest.fn(() => 0),
    getSource: jest.fn(() => undefined),
    getZoom: jest.fn(() => 4),
    getPadding: jest.fn(() => padding),
    on: jest.fn((event: string, ...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === 'function') {
        mockEventHandlers.set(event, args[0] as (event?: unknown) => void);
      }
    }),
    remove: jest.fn(),
    resize: jest.fn(),
    setPadding,
    setLayoutProperty: jest.fn(),
    setProjection: jest.fn(),
    setSky: jest.fn(),
    stop: jest.fn(),
  };
}

const delayedJourney: AtlasJourneySummary = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'A delayed journey',
  version: 1,
  updatedAt: '2026-09-14T12:00:00.000Z',
  startDate: '2026-09-10',
  endDate: '2026-09-11',
  memoryCount: 2,
  drawable: true,
  stops: [
    {
      entryId: '00000000-0000-4000-8000-000000000011',
      position: 0,
      title: 'First stop',
      placeLabel: 'Detroit, Michigan',
      placeName: 'Detroit',
      visitedOn: '2026-09-10',
      latitude: 42.3314,
      longitude: -83.0458,
    },
    {
      entryId: '00000000-0000-4000-8000-000000000012',
      position: 1,
      title: 'Selected stop',
      placeLabel: 'Ann Arbor, Michigan',
      placeName: 'Ann Arbor',
      visitedOn: '2026-09-11',
      latitude: 42.2808,
      longitude: -83.743,
    },
  ],
};

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
    mockMarkerElements.length = 0;
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

  it('synchronizes a deep-linked stop when a delayed map finishes loading', async () => {
    render(
      <AtlasMap
        entries={[]}
        initialView={initialView}
        interactionLocked={false}
        selectedId={null}
        placementMode={false}
        focusRequest={{ id: null, nonce: 0 }}
        fitRequest={0}
        onSelect={jest.fn()}
        onPlace={jest.fn()}
        onViewChange={jest.fn()}
        mode="journeys"
        journeys={[delayedJourney]}
        selectedJourneyId={delayedJourney.id}
        selectedJourneyStopId={delayedJourney.stops[1].entryId}
      />,
    );

    expect(mockMarkerElements).toHaveLength(0);
    act(() => {
      mockEventHandlers.get('load')?.();
    });

    await waitFor(() => expect(mockMarkerElements).toHaveLength(2));
    expect(mockMarkerElements[0]).toHaveAttribute('data-current', 'false');
    expect(mockMarkerElements[0]).not.toHaveAttribute('aria-current');
    expect(mockMarkerElements[1]).toHaveAttribute('data-current', 'true');
    expect(mockMarkerElements[1]).toHaveAttribute('aria-current', 'step');
  });

  it('clears retained stop padding before refitting every journey', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const baseProps = {
      entries: [],
      initialView,
      interactionLocked: false,
      selectedId: null,
      placementMode: false,
      focusRequest: { id: null, nonce: 0 },
      fitRequest: 0,
      onSelect: jest.fn(),
      onPlace: jest.fn(),
      onViewChange: jest.fn(),
      mode: 'journeys' as const,
      journeys: [delayedJourney],
      selectedJourneyStopId: delayedJourney.stops[1].entryId,
    };
    const { rerender } = render(
      <AtlasMap {...baseProps} selectedJourneyId={delayedJourney.id} />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
    expect(map.getPadding()).toEqual({
      top: 90,
      right: 64,
      bottom: 80,
      left: 538,
    });

    map.fitBounds.mockClear();
    map.setPadding.mockClear();
    rerender(<AtlasMap {...baseProps} selectedJourneyId={null} />);

    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    expect(map.stop).toHaveBeenCalled();
    expect(map.resize).toHaveBeenCalled();
    expect(map.setPadding).toHaveBeenCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(map.setPadding.mock.invocationCallOrder[0]).toBeLessThan(
      map.fitBounds.mock.invocationCallOrder[0],
    );
    expect(map.fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        padding: { top: 90, right: 64, bottom: 80, left: 538 },
      }),
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
