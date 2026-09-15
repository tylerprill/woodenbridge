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
import type { ComponentProps } from 'react';

import type { AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import { ATLAS_JOURNEY_ROUTE_SOURCE } from '@/components/atlas/atlas-journey-layers';
import AtlasMap from '@/components/atlas/atlas-map';

const mockMapConstructor = jest.fn();
const mockEventHandlers = new Map<string, (event?: unknown) => void>();
const mockMarkerElements: HTMLButtonElement[] = [];
const mockMarkerOptions: Array<{
  anchor?: string;
  element: HTMLButtonElement;
  offset?: [number, number];
  subpixelPositioning?: boolean;
  opacityWhenCovered?: number;
}> = [];
const mockBoundsExtends: jest.Mock[] = [];
const mockMarkers: Array<{
  addTo: jest.Mock;
  getElement: jest.Mock;
  remove: jest.Mock;
  setLngLat: jest.Mock;
}> = [];

jest.mock(
  'maplibre-gl',
  () => ({
    __esModule: true,
    Map: function MockMap(...args: unknown[]) {
      return mockMapConstructor(...args);
    },
    AttributionControl: jest.fn(),
    ScaleControl: jest.fn(),
    LngLat: Object.assign(
      function MockLngLat(longitude: number, latitude: number) {
        return { lng: longitude, lat: latitude };
      },
      {
        convert: (
          coordinate: [number, number] | { lng: number; lat: number },
        ) =>
          Array.isArray(coordinate)
            ? { lng: coordinate[0], lat: coordinate[1] }
            : coordinate,
      },
    ),
    LngLatBounds: function MockLngLatBounds() {
      const bounds = { extend: jest.fn() };
      bounds.extend.mockReturnValue(bounds);
      mockBoundsExtends.push(bounds.extend);
      return bounds;
    },
    Marker: function MockMarker(options: {
      anchor?: string;
      element: HTMLButtonElement;
      offset?: [number, number];
      subpixelPositioning?: boolean;
      opacityWhenCovered?: number;
    }) {
      const { element } = options;
      mockMarkerElements.push(element);
      mockMarkerOptions.push(options);
      const marker = {
        addTo: jest.fn(),
        getElement: jest.fn(() => element),
        remove: jest.fn(() => element.remove()),
        setLngLat: jest.fn(),
      };
      marker.addTo.mockImplementation(
        (map: { getContainer: () => HTMLElement }) => {
          map.getContainer().append(element);
          return marker;
        },
      );
      marker.setLngLat.mockReturnValue(marker);
      mockMarkers.push(marker);
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

function createMapMock({
  width = 1000,
  height = 752,
}: { width?: number; height?: number } = {}) {
  const canvas = document.createElement('canvas');
  const container = document.createElement('div');
  const sources = new Map<string, { setData: jest.Mock }>();
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
  let projection = { type: 'mercator' };
  let padding = { top: 0, right: 0, bottom: 0, left: 0 };
  const easeTo = jest.fn((options: { padding?: typeof padding } = {}) => {
    if (options.padding) padding = options.padding;
  });
  const setPadding = jest.fn((nextPadding: typeof padding) => {
    padding = nextPadding;
  });
  const addSource = jest.fn((id: string) => {
    sources.set(id, { setData: jest.fn() });
  });
  const setProjection = jest.fn((nextProjection: { type: string }) => {
    projection = nextProjection;
  });
  return {
    keyboard: { disableRotation: jest.fn() },
    touchZoomRotate: { disableRotation: jest.fn() },
    addControl: jest.fn(),
    addLayer: jest.fn(),
    addSource,
    cameraForBounds: jest.fn(() => ({ center: [0, 0], zoom: 4, bearing: 0 })),
    easeTo,
    fitBounds: jest.fn(),
    getBearing: jest.fn(() => 0),
    setStyle: jest.fn(),
    getCanvas: jest.fn(() => canvas),
    getCenter: jest.fn(() => ({ lng: 0, lat: 0 })),
    getContainer: jest.fn(() => container),
    getLayer: jest.fn(() => undefined),
    getPitch: jest.fn(() => 0),
    getProjection: jest.fn(() => projection),
    getSource: jest.fn((id: string) => sources.get(id)),
    getVerticalFieldOfView: jest.fn(() => 36.86989764584402),
    getZoom: jest.fn(() => 4),
    getPadding: jest.fn(() => padding),
    on: jest.fn((event: string, ...args: unknown[]) => {
      if (args.length === 1 && typeof args[0] === 'function') {
        mockEventHandlers.set(event, args[0] as (event?: unknown) => void);
      }
    }),
    remove: jest.fn(),
    removeFeatureState: jest.fn(),
    resize: jest.fn(),
    setPadding,
    setFeatureState: jest.fn(),
    setLayoutProperty: jest.fn(),
    setMinZoom: jest.fn(),
    setProjection,
    setSky: jest.fn(),
    setTransformConstrain: jest.fn(),
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

function renderJourneyMap(
  journey = delayedJourney,
  overrides: Partial<ComponentProps<typeof AtlasMap>> = {},
) {
  const props = {
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
    journeys: [journey],
    selectedJourneyId: journey.id,
    ...overrides,
  };
  return { ...render(<AtlasMap {...props} />), props };
}

describe('Atlas map failure recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventHandlers.clear();
    mockMarkerElements.length = 0;
    mockMarkerOptions.length = 0;
    mockBoundsExtends.length = 0;
    mockMarkers.length = 0;
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
    expect(
      mockMarkerOptions.map(
        ({ anchor, offset, subpixelPositioning, opacityWhenCovered }) => ({
          anchor,
          offset,
          subpixelPositioning,
          opacityWhenCovered,
        }),
      ),
    ).toEqual([
      {
        anchor: 'center',
        offset: [0, 0],
        subpixelPositioning: true,
        opacityWhenCovered: 0,
      },
      {
        anchor: 'center',
        offset: [0, 0],
        subpixelPositioning: true,
        opacityWhenCovered: 0,
      },
    ]);
    expect(
      mockMarkers.map((marker) => marker.setLngLat.mock.calls[0]?.[0]),
    ).toEqual([
      [delayedJourney.stops[0].longitude, delayedJourney.stops[0].latitude],
      [delayedJourney.stops[1].longitude, delayedJourney.stops[1].latitude],
    ]);
  });

  it('uses a world-scale zoom floor only while the Journey lens is active', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const sharedProps = {
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
      journeys: [delayedJourney],
    };
    const { rerender } = render(<AtlasMap {...sharedProps} mode="journeys" />);

    expect(mockMapConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ minZoom: -2 }),
    );
    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.setMinZoom).toHaveBeenCalledWith(-2));
    const constrainCamera = map.setTransformConstrain.mock.calls.at(-1)?.[0] as
      | ((center: { lng: number; lat: number }, zoom: number) => unknown)
      | undefined;
    expect(constrainCamera).toEqual(expect.any(Function));
    expect(constrainCamera?.({ lng: 181, lat: 90 }, -10)).toEqual({
      center: { lng: 181, lat: 85.0511287798066 },
      zoom: -2,
    });
    expect(constrainCamera?.({ lng: -181, lat: -90 }, 30)).toEqual({
      center: { lng: -181, lat: -85.0511287798066 },
      zoom: 18,
    });

    rerender(<AtlasMap {...sharedProps} mode="places" />);
    await waitFor(() => expect(map.setMinZoom).toHaveBeenCalledWith(1));
    expect(map.setTransformConstrain).toHaveBeenLastCalledWith(null);
    expect(map.getPadding()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('keeps a single-stop Journey above the compact bottom sheet', async () => {
    const map = createMapMock({ width: 390, height: 844 });
    mockMapConstructor.mockReturnValue(map);
    const singleStopJourney = {
      ...delayedJourney,
      stops: [delayedJourney.stops[0]],
    };

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
        journeys={[singleStopJourney]}
        selectedJourneyId={singleStopJourney.id}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() =>
      expect(map.easeTo).toHaveBeenCalledWith(
        expect.objectContaining({
          padding: { top: 51, right: 47, bottom: 540, left: 47 },
        }),
      ),
    );
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('refreshes the Journey inset and fit after a portrait-to-landscape resize', async () => {
    const map = createMapMock({ width: 390, height: 844 });
    mockMapConstructor.mockReturnValue(map);

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
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
    map.fitBounds.mockClear();
    Object.defineProperties(map.getContainer(), {
      clientHeight: { configurable: true, value: 412 },
      clientWidth: { configurable: true, value: 915 },
    });
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    expect(map.getPadding()).toEqual({
      top: 112,
      right: 408,
      bottom: 102,
      left: 70,
    });
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ padding: 0 }),
    );
    map.fitBounds.mockClear();
    map.resize.mockClear();
    fireEvent(window, new Event('resize'));
    await waitFor(() => expect(map.resize).toHaveBeenCalled());
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('uses the CSS bottom-sheet layout when a tall portrait viewport has a short canvas', async () => {
    jest.replaceProperty(window, 'innerWidth', 600);
    jest.replaceProperty(window, 'innerHeight', 510);
    const map = createMapMock({ width: 600, height: 400 });
    const workspace = document.createElement('section');
    workspace.className = 'atlas-workspace-root';
    workspace.style.setProperty('--atlas-journey-layout', 'bottom');
    // The workspace is authoritative, not a contradictory descendant token
    // or the short canvas height that would previously infer a right rail.
    map.getContainer().style.setProperty('--atlas-journey-layout', 'landscape');
    workspace.append(map.getContainer());
    mockMapConstructor.mockReturnValue(map);

    const { container: renderedContainer } = render(
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
    renderedContainer.append(workspace);

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.easeTo).toHaveBeenCalled());

    expect(map.setPadding).toHaveBeenCalledWith({
      top: 46,
      right: 94,
      bottom: 278,
      left: 94,
    });
    expect(map.getPadding()).toEqual({
      top: 24,
      right: 72,
      bottom: 256,
      left: 72,
    });
  });

  it.each(['overview', 'active stop'])(
    'refreshes the %s camera after a CSS layout switch without a canvas resize',
    async (cameraMode) => {
      const map = createMapMock({ width: 1000, height: 400 });
      const workspace = document.createElement('section');
      workspace.className = 'atlas-workspace-root';
      workspace.style.setProperty('--atlas-journey-layout', 'wide-right');
      workspace.append(map.getContainer());
      mockMapConstructor.mockReturnValue(map);
      const hasSelectedStop = cameraMode === 'active stop';

      const { container: renderedContainer } = render(
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
          selectedJourneyStopId={
            hasSelectedStop ? delayedJourney.stops[1].entryId : null
          }
        />,
      );
      renderedContainer.append(workspace);

      act(() => {
        mockEventHandlers.get('load')?.();
      });
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      expect(map.getPadding()).toEqual(
        hasSelectedStop
          ? { top: 190, right: 420, bottom: 80, left: 112 }
          : { top: 212, right: 442, bottom: 102, left: 134 },
      );

      map.fitBounds.mockClear();
      map.easeTo.mockClear();
      workspace.style.setProperty('--atlas-journey-layout', 'right');
      fireEvent(window, new Event('resize'));

      await waitFor(() =>
        expect(
          hasSelectedStop ? map.easeTo : map.fitBounds,
        ).toHaveBeenCalledTimes(1),
      );
      expect(map.getPadding()).toEqual(
        hasSelectedStop
          ? { top: 170, right: 412, bottom: 80, left: 24 }
          : { top: 192, right: 434, bottom: 102, left: 46 },
      );

      map.fitBounds.mockClear();
      map.easeTo.mockClear();
      workspace.style.setProperty('--atlas-journey-layout', 'bottom');
      fireEvent(window, new Event('resize'));

      await waitFor(() =>
        expect(
          hasSelectedStop ? map.easeTo : map.fitBounds,
        ).toHaveBeenCalledTimes(1),
      );
      expect(map.getPadding()).toEqual(
        hasSelectedStop
          ? { top: 24, right: 120, bottom: 256, left: 120 }
          : { top: 46, right: 142, bottom: 278, left: 142 },
      );
      expect(map.getContainer().clientWidth).toBe(1000);
      expect(map.getContainer().clientHeight).toBe(400);
    },
  );

  it.each([895, 896])(
    'preserves the wide toolbar gutter on a %ipx canvas inside a wide CSS container',
    async (width) => {
      const map = createMapMock({ width, height: 700 });
      const workspace = document.createElement('section');
      workspace.className = 'atlas-workspace-root';
      workspace.style.setProperty('--atlas-journey-layout', 'wide-right');
      Object.defineProperty(workspace, 'clientWidth', { value: width + 2 });
      workspace.append(map.getContainer());
      mockMapConstructor.mockReturnValue(map);

      const { container: renderedContainer } = render(
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
      renderedContainer.append(workspace);

      act(() => {
        mockEventHandlers.get('load')?.();
      });
      await waitFor(() => expect(map.easeTo).toHaveBeenCalled());
      expect(map.getPadding()).toEqual({
        top: 190,
        right: Math.ceil(width * 0.4 + 36),
        bottom: 80,
        left: 112,
      });
    },
  );

  it('locks geodesic route endpoints to the exact marker coordinates', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const curvedJourney: AtlasJourneySummary = {
      ...delayedJourney,
      stops: [
        { ...delayedJourney.stops[0], longitude: -75, latitude: 40 },
        { ...delayedJourney.stops[1], longitude: 75, latitude: 40 },
      ],
    };

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
        journeys={[curvedJourney]}
        selectedJourneyId={curvedJourney.id}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(mockMarkers).toHaveLength(2));

    const routeSourceCall = (
      map.addSource.mock.calls as unknown as Array<
        [string, { data?: GeoJSON.FeatureCollection<GeoJSON.LineString> }]
      >
    ).find(([sourceId]) => sourceId === ATLAS_JOURNEY_ROUTE_SOURCE);
    const routeData = routeSourceCall?.[1]?.data as
      GeoJSON.FeatureCollection<GeoJSON.LineString> | undefined;
    const routeCoordinates = routeData?.features[0]?.geometry.coordinates;
    const markerCoordinates = mockMarkers.map(
      (marker) => marker.setLngLat.mock.calls[0]?.[0],
    );

    expect(routeCoordinates?.length).toBeGreaterThan(2);
    expect(routeCoordinates?.[0]).toEqual(markerCoordinates[0]);
    expect(routeCoordinates?.at(-1)).toEqual(markerCoordinates[1]);
  });

  it('reserves space for the taller mobile playback sheet when focusing a stop', async () => {
    const map = createMapMock({ width: 390, height: 470 });
    mockMapConstructor.mockReturnValue(map);
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
        journeyPlaybackIndex={1}
      />,
    );
    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() =>
      expect(map.easeTo).toHaveBeenLastCalledWith(
        expect.objectContaining({
          padding: { top: 56, right: 47, bottom: 381, left: 47 },
        }),
      ),
    );
  });

  it('renders a true polar geodesic and fits its apex on the desktop globe', async () => {
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(1000);
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const polarJourney: AtlasJourneySummary = {
      ...delayedJourney,
      stops: [
        { ...delayedJourney.stops[0], longitude: 0, latitude: 80 },
        { ...delayedJourney.stops[1], longitude: 180, latitude: 80 },
      ],
    };

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
        journeys={[polarJourney]}
        selectedJourneyId={polarJourney.id}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(mockMarkers).toHaveLength(2));

    const routeSourceCall = (
      map.addSource.mock.calls as unknown as Array<
        [string, { data?: GeoJSON.FeatureCollection<GeoJSON.LineString> }]
      >
    ).find(([sourceId]) => sourceId === ATLAS_JOURNEY_ROUTE_SOURCE);
    const routeCoordinates = routeSourceCall?.[1]?.data?.features[0]?.geometry
      .coordinates as Array<[number, number]>;
    const fittedCoordinates = mockBoundsExtends
      .at(-1)
      ?.mock.calls.map(([coordinate]) => coordinate as [number, number]);

    expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
    expect(map.setTransformConstrain).toHaveBeenCalledWith(null);
    expect(map.getPadding()).toEqual({
      top: 212,
      right: 442,
      bottom: 102,
      left: 134,
    });
    expect(map.fitBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ padding: 0 }),
    );
    expect(
      Math.max(...routeCoordinates.map(([, latitude]) => latitude)),
    ).toBeGreaterThan(89);
    expect(
      Math.max(...(fittedCoordinates ?? []).map(([, latitude]) => latitude)),
    ).toBeGreaterThan(89);
  });

  it('collapses coincident pole stops with matching markers on compact maps', async () => {
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(390);
    const map = createMapMock({ width: 390, height: 844 });
    mockMapConstructor.mockReturnValue(map);
    const polarJourney: AtlasJourneySummary = {
      ...delayedJourney,
      stops: [
        { ...delayedJourney.stops[0], longitude: 0, latitude: 90 },
        { ...delayedJourney.stops[1], longitude: 180, latitude: 90 },
      ],
    };

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
        journeys={[polarJourney]}
        selectedJourneyId={polarJourney.id}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(mockMarkers).toHaveLength(2));

    const routeSourceCall = (
      map.addSource.mock.calls as unknown as Array<
        [string, { data?: GeoJSON.FeatureCollection<GeoJSON.LineString> }]
      >
    ).find(([sourceId]) => sourceId === ATLAS_JOURNEY_ROUTE_SOURCE);
    const routeCoordinates = routeSourceCall?.[1]?.data?.features[0]?.geometry
      .coordinates as Array<[number, number]>;
    const markerCoordinates = mockMarkers.map(
      (marker) => marker.setLngLat.mock.calls[0]?.[0],
    );
    const fittedCoordinates = mockBoundsExtends
      .at(-1)
      ?.mock.calls.map(([coordinate]) => coordinate as [number, number]);

    expect(map.setProjection).not.toHaveBeenCalled();
    expect(routeCoordinates).toHaveLength(2);
    expect(routeCoordinates[0]).toEqual(routeCoordinates[1]);
    expect(
      Math.max(...routeCoordinates.map(([, latitude]) => latitude)),
    ).toBeLessThanOrEqual(85.0511287798066);
    expect(routeCoordinates[0]).toEqual(markerCoordinates[0]);
    expect(routeCoordinates.at(-1)).toEqual(markerCoordinates[1]);
    expect(
      Math.max(...(fittedCoordinates ?? []).map(([, latitude]) => latitude)),
    ).toBeLessThanOrEqual(85.0511287798066);
  });

  it('does not rebuild geodesic source data for selection or playback state', async () => {
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
    };
    const { rerender } = render(
      <AtlasMap
        {...baseProps}
        selectedJourneyId={null}
        journeyPlaybackIndex={null}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() =>
      expect(map.addSource).toHaveBeenCalledWith(
        ATLAS_JOURNEY_ROUTE_SOURCE,
        expect.anything(),
      ),
    );
    const routeSource = map.getSource(ATLAS_JOURNEY_ROUTE_SOURCE);
    routeSource?.setData.mockClear();

    rerender(
      <AtlasMap
        {...baseProps}
        selectedJourneyId={delayedJourney.id}
        journeyPlaybackIndex={0}
      />,
    );
    await waitFor(() => expect(map.setFeatureState).toHaveBeenCalled());
    expect(routeSource?.setData).not.toHaveBeenCalled();

    map.setFeatureState.mockClear();
    rerender(
      <AtlasMap
        {...baseProps}
        selectedJourneyId={delayedJourney.id}
        journeyPlaybackIndex={1}
      />,
    );
    await waitFor(() => expect(map.setFeatureState).toHaveBeenCalledTimes(1));
    expect(routeSource?.setData).not.toHaveBeenCalled();

    const movedJourney = {
      ...delayedJourney,
      stops: [
        delayedJourney.stops[0],
        { ...delayedJourney.stops[1], longitude: -82 },
      ],
    };
    rerender(
      <AtlasMap
        {...baseProps}
        journeys={[movedJourney]}
        selectedJourneyId={movedJourney.id}
        journeyPlaybackIndex={1}
      />,
    );
    await waitFor(() => expect(routeSource?.setData).toHaveBeenCalledTimes(1));
    expect(map.removeFeatureState).toHaveBeenCalledWith({
      source: ATLAS_JOURNEY_ROUTE_SOURCE,
    });
  });

  it('fits a selected Journey around the geodesic arc apex', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const curvedJourney: AtlasJourneySummary = {
      ...delayedJourney,
      stops: [
        { ...delayedJourney.stops[0], longitude: -75, latitude: 40 },
        { ...delayedJourney.stops[1], longitude: 75, latitude: 40 },
      ],
    };

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
        journeys={[curvedJourney]}
        selectedJourneyId={curvedJourney.id}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());

    const fittedCoordinates = mockBoundsExtends
      .at(-1)
      ?.mock.calls.map(([coordinate]) => coordinate as [number, number]);
    expect(fittedCoordinates?.length).toBeGreaterThan(2);
    expect(
      Math.max(...(fittedCoordinates ?? []).map(([, latitude]) => latitude)),
    ).toBeGreaterThan(70);
  });

  it('keeps an overview Journey date-line crossing in one compact world copy', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const dateLineJourney: AtlasJourneySummary = {
      ...delayedJourney,
      stops: [
        { ...delayedJourney.stops[0], longitude: 179, latitude: 40 },
        { ...delayedJourney.stops[1], longitude: -179, latitude: 42 },
      ],
    };

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
        journeys={[dateLineJourney]}
        selectedJourneyId={null}
      />,
    );

    act(() => {
      mockEventHandlers.get('load')?.();
    });
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());

    const fittedCoordinates = mockBoundsExtends
      .at(-1)
      ?.mock.calls.map(([coordinate]) => coordinate as [number, number]);
    const longitudes = fittedCoordinates?.map(([longitude]) => longitude) ?? [];
    expect(fittedCoordinates?.length).toBeGreaterThan(2);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThan(3);
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
      top: 190,
      right: 420,
      bottom: 80,
      left: 112,
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
        padding: 0,
      }),
    );
    expect(map.getPadding()).toEqual({
      top: 212,
      right: 442,
      bottom: 102,
      left: 134,
    });
  });

  it('recreates world-Journey markers at the settled route copy and preserves focused stop access', async () => {
    const worldJourney: AtlasJourneySummary = {
      ...delayedJourney,
      memoryCount: 10,
      stops: [
        [12.4924, 41.8902],
        [31.1342, 29.9792],
        [35.4444, 30.3285],
        [78.0421, 27.1751],
        [103.867, 13.4125],
        [116.5704, 40.4319],
        [151.2153, -33.8568],
        [-109.2766, -27.1259],
        [-72.545, -13.1631],
        [-88.5678, 20.6843],
      ].map(([longitude, latitude], index) => ({
        ...delayedJourney.stops[0],
        entryId: `world-stop-${index}`,
        position: index,
        longitude,
        latitude,
      })),
    };
    const map = createMapMock({ width: 742, height: 925 });
    map.cameraForBounds.mockReturnValue({
      center: [150, 0],
      zoom: 0.3,
      bearing: 0,
    });
    map.getCenter.mockReturnValue({ lng: 150, lat: 0 });
    map.getZoom.mockReturnValue(0.3);
    mockMapConstructor.mockReturnValue(map);
    const { container } = renderJourneyMap(worldJourney);
    container.append(map.getContainer());
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(10));
    const previousMarkers = mockMarkers.slice();
    previousMarkers[2].getElement().focus();
    const focus = jest.spyOn(HTMLElement.prototype, 'focus');
    const routeSource = map.getSource(ATLAS_JOURNEY_ROUTE_SOURCE);
    const previousSourceUpdates = routeSource?.setData.mock.calls.length;

    act(() => mockEventHandlers.get('moveend')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(20));
    const freshMarkers = mockMarkers.slice(10);
    const fittedCoordinates = mockBoundsExtends
      .at(-1)!
      .mock.calls.map(([coordinate]) => coordinate as [number, number]);

    freshMarkers.forEach((marker, index) => {
      expect(previousMarkers[index].remove).toHaveBeenCalledTimes(1);
      expect(marker.getElement()).not.toBe(previousMarkers[index].getElement());
      expect(fittedCoordinates).toContainEqual(
        marker.setLngLat.mock.calls[0][0],
      );
    });
    expect(freshMarkers[0].setLngLat).toHaveBeenCalledWith([12.4924, 41.8902]);
    expect(document.activeElement).toBe(freshMarkers[2].getElement());
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(routeSource?.setData.mock.calls.length).toBe(previousSourceUpdates);
  });

  it('shifts fresh markers with an equivalent settled camera world copy', async () => {
    const map = createMapMock();
    map.cameraForBounds.mockReturnValue({
      center: [190, 0],
      zoom: 4,
      bearing: 0,
    });
    map.getCenter.mockReturnValue({ lng: -170, lat: 0 });
    mockMapConstructor.mockReturnValue(map);
    const { container } = renderJourneyMap();
    container.append(map.getContainer());
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(2));
    const fittedCoordinates = mockBoundsExtends
      .at(-1)!
      .mock.calls.map(([coordinate]) => coordinate as [number, number]);

    act(() => mockEventHandlers.get('moveend')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(4));
    mockMarkers.slice(2).forEach((marker) => {
      const [longitude, latitude] = marker.setLngLat.mock.calls[0][0];
      expect(fittedCoordinates).toContainEqual([longitude + 360, latitude]);
    });
  });

  it('refreshes an explicit whole-path fit even when a stop remains selected', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const { props, rerender } = renderJourneyMap(delayedJourney, {
      selectedJourneyStopId: delayedJourney.stops[1].entryId,
    });
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(2));
    rerender(<AtlasMap {...props} journeyFitRequest={1} />);
    act(() => mockEventHandlers.get('moveend')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(4));
    expect(mockMarkers[3].getElement()).toHaveAttribute('aria-current', 'step');
  });

  it('discards interrupted whole fits and fits superseded by stop focus', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const { props, rerender } = renderJourneyMap();
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(2));
    map.getCenter.mockReturnValue({ lng: 10, lat: 0 });
    act(() => mockEventHandlers.get('moveend')?.());
    map.getCenter.mockReturnValue({ lng: 0, lat: 0 });
    act(() => mockEventHandlers.get('moveend')?.());
    expect(mockMarkers).toHaveLength(2);

    rerender(<AtlasMap {...props} journeyFitRequest={1} />);
    rerender(
      <AtlasMap
        {...props}
        journeyFitRequest={1}
        selectedJourneyStopId={delayedJourney.stops[1].entryId}
      />,
    );
    act(() => mockEventHandlers.get('moveend')?.());
    expect(mockMarkers).toHaveLength(2);
  });

  it('handles synchronous reduced-motion fits without stale completion listeners', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    jest.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    map.fitBounds.mockImplementation((_bounds, options) => {
      if (options.duration === 0) mockEventHandlers.get('moveend')?.();
    });
    renderJourneyMap();
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(4));
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 0 }),
    );
    act(() => mockEventHandlers.get('moveend')?.());
    expect(mockMarkers).toHaveLength(4);
  });

  it('does not restore stale marker focus after Places or steal focus from another control', async () => {
    const map = createMapMock();
    mockMapConstructor.mockReturnValue(map);
    const { props, rerender, container } = renderJourneyMap();
    container.append(map.getContainer());
    const otherControl = document.createElement('button');
    container.append(otherControl);
    act(() => mockEventHandlers.get('load')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(2));
    mockMarkers[0].getElement().focus();
    rerender(<AtlasMap {...props} mode="places" />);
    otherControl.focus();
    rerender(<AtlasMap {...props} />);
    expect(document.activeElement).toBe(otherControl);

    const currentMarkers = mockMarkers.slice(2);
    currentMarkers[0].getElement().focus();
    currentMarkers[0].remove.mockImplementation(() => {
      currentMarkers[0].getElement().remove();
      otherControl.focus();
    });
    act(() => mockEventHandlers.get('moveend')?.());
    await waitFor(() => expect(mockMarkers).toHaveLength(6));
    expect(document.activeElement).toBe(otherControl);
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
