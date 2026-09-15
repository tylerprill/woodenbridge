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

import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import { ATLAS_JOURNEY_ROUTE_SOURCE } from '@/components/atlas/atlas-journey-layers';
import AtlasMap from '@/components/atlas/atlas-map';
import {
  ATLAS_CLUSTER_LAYER,
  ATLAS_PIN_LAYER,
  ATLAS_SOURCE_ID,
} from '@/components/atlas/atlas-layers';
import { getAtlasJourneyGlobeFitZoomLimit } from '@/components/atlas/atlas-map-camera';

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

type RenderedPlaceFeature = GeoJSON.Feature<
  GeoJSON.Point,
  { id?: string; cluster_id?: number; point_count?: number }
>;

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
  const sources = new Map<
    string,
    { setData: jest.Mock; getClusterExpansionZoom: jest.Mock }
  >();
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
    sources.set(id, {
      setData: jest.fn(),
      getClusterExpansionZoom: jest.fn(async () => 9),
    });
  });
  const setProjection = jest.fn((nextProjection: { type: string }) => {
    projection = nextProjection;
  });
  return {
    doubleClickZoom: { disable: jest.fn(), enable: jest.fn() },
    keyboard: { disableRotation: jest.fn() },
    touchZoomRotate: {
      disable: jest.fn(),
      disableRotation: jest.fn(),
      enable: jest.fn(),
    },
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
    project: jest.fn(
      (coordinate: [number, number] | { lng: number; lat: number }) =>
        Array.isArray(coordinate)
          ? { x: coordinate[0], y: coordinate[1] }
          : { x: coordinate.lng, y: coordinate.lat },
    ),
    queryRenderedFeatures: jest.fn(
      (
        _point: unknown,
        _options: { layers: string[] },
      ): RenderedPlaceFeature[] => [],
    ),
    unproject: jest.fn((_point: unknown) => ({
      lng: Number.NaN,
      lat: Number.NaN,
    })),
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

function createEntry(
  id: string,
  overrides: Partial<AtlasEntry> = {},
): AtlasEntry {
  return {
    id,
    title: `Memory ${id}`,
    description: 'A saved travel memory.',
    placeLabel: 'Detroit, Michigan',
    placeName: 'Detroit',
    placeLocality: 'Detroit',
    placeRegion: 'Michigan',
    placeCountry: 'United States',
    placeCountryCode: 'US',
    placeGeocoder: null,
    placeGeocodedAt: null,
    visitedOn: '2026-09-10',
    recordState: 'saved',
    journeyState: 'visited',
    latitude: 42.3314,
    longitude: -83.0458,
    version: 1,
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    media: [],
    ...overrides,
  };
}

function placeFeature(entry: AtlasEntry): RenderedPlaceFeature {
  return {
    type: 'Feature',
    id: entry.id,
    properties: { id: entry.id },
    geometry: {
      type: 'Point',
      coordinates: [entry.longitude, entry.latitude],
    },
  };
}

function renderBuilderMap(
  entries: AtlasEntry[],
  overrides: Partial<ComponentProps<typeof AtlasMap>> = {},
) {
  const props = {
    entries,
    initialView,
    interactionLocked: false,
    selectedId: null,
    placementMode: false,
    focusRequest: { id: null, nonce: 0 },
    fitRequest: 0,
    onSelect: jest.fn(),
    onPlace: jest.fn(),
    onViewChange: jest.fn(),
    mode: 'places' as const,
    builderActive: true,
    ...overrides,
  };
  return { ...render(<AtlasMap {...props} />), props };
}

function delegatedHandler(
  map: ReturnType<typeof createMapMock>,
  event: string,
  layer: string,
) {
  const registration = map.on.mock.calls.find(
    ([registeredEvent, registeredLayer]) =>
      registeredEvent === event && registeredLayer === layer,
  );
  expect(registration).toBeDefined();
  return registration?.[2] as (event: unknown) => void | Promise<void>;
}

function addAttributionControl(
  map: ReturnType<typeof createMapMock>,
  height = 24,
  bottomGap = 6,
) {
  const container = map.getContainer();
  const canvasBounds = new DOMRect(
    50,
    100,
    container.clientWidth,
    container.clientHeight,
  );
  const containerBounds = jest
    .spyOn(container, 'getBoundingClientRect')
    .mockReturnValue(canvasBounds);
  const element = document.createElement('details');
  element.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
  element.textContent = '© OpenStreetMap © OpenFreeMap';
  container.append(element);
  const creditBounds = jest.spyOn(element, 'getBoundingClientRect');
  const setCreditHeight = (nextHeight: number) =>
    creditBounds.mockReturnValue(
      new DOMRect(
        canvasBounds.right - 260,
        canvasBounds.bottom - bottomGap - nextHeight,
        250,
        nextHeight,
      ),
    );
  setCreditHeight(height);
  return {
    element,
    canvasBounds,
    containerBounds,
    creditBounds,
    setCreditHeight,
  };
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

  describe('Journey builder map selection', () => {
    const entries = [
      createEntry('entry-a', { longitude: -83, latitude: 42 }),
      createEntry('entry-b', { longitude: 2, latitude: 49 }),
    ];

    describe('visible attribution clearance', () => {
      type MockResizeObserver = {
        disconnect: jest.Mock;
        notify: () => void;
        observe: jest.Mock;
        unobserve: jest.Mock;
      };
      const observers: MockResizeObserver[] = [];
      const originalResizeObserver = Object.getOwnPropertyDescriptor(
        globalThis,
        'ResizeObserver',
      );

      beforeEach(() => {
        observers.length = 0;
        Object.defineProperty(globalThis, 'ResizeObserver', {
          configurable: true,
          writable: true,
          value: jest.fn((callback: ResizeObserverCallback) => {
            const observer: MockResizeObserver = {
              disconnect: jest.fn(),
              notify: () => callback([], observer as unknown as ResizeObserver),
              observe: jest.fn(),
              unobserve: jest.fn(),
            };
            observers.push(observer);
            return observer;
          }),
        });
      });

      afterEach(() => {
        if (originalResizeObserver) {
          Object.defineProperty(
            globalThis,
            'ResizeObserver',
            originalResizeObserver,
          );
        } else {
          Reflect.deleteProperty(globalThis, 'ResizeObserver');
        }
      });

      it('retains the minimum bottom gutter when no visible credits exist', async () => {
        const map = createMapMock();
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(entries);
        act(() => mockEventHandlers.get('load')?.());
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
        expect(map.getPadding()).toEqual({
          top: 80,
          right: 32,
          bottom: 32,
          left: 32,
        });
      });

      it.each([
        { height: 24, expectedBottom: 56 },
        { height: 60, expectedBottom: 92 },
      ])(
        'clears $height-pixel credits, their bottom offset, and the full pin target',
        async ({ height, expectedBottom }) => {
          const map = createMapMock();
          const attribution = addAttributionControl(map, height);
          mockMapConstructor.mockReturnValue(map);
          renderBuilderMap(entries);
          act(() => mockEventHandlers.get('load')?.());
          await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
          expect(map.getPadding()).toEqual({
            top: 80,
            right: 32,
            bottom: expectedBottom,
            left: 32,
          });
          expect(observers.at(-1)?.observe).toHaveBeenCalledWith(
            attribution.element,
          );
        },
      );

      it.each([
        'zero width',
        'zero height',
        'display none',
        'visibility hidden',
        'visibility collapse',
        'opacity zero',
        'outside horizontally',
        'outside vertically',
      ])('does not reserve credits with %s', async (kind) => {
        const map = createMapMock();
        const attribution = addAttributionControl(map);
        const creditBounds = attribution.element.getBoundingClientRect();
        if (kind === 'zero width') {
          attribution.creditBounds.mockReturnValue(
            new DOMRect(creditBounds.x, creditBounds.y, 0, 24),
          );
        } else if (kind === 'zero height') {
          attribution.creditBounds.mockReturnValue(
            new DOMRect(creditBounds.x, creditBounds.y, 250, 0),
          );
        } else if (kind === 'display none') {
          attribution.element.style.display = 'none';
        } else if (kind === 'visibility hidden') {
          attribution.element.style.visibility = 'hidden';
        } else if (kind === 'visibility collapse') {
          attribution.element.style.visibility = 'collapse';
        } else if (kind === 'opacity zero') {
          attribution.element.style.opacity = '0';
        } else if (kind === 'outside horizontally') {
          attribution.creditBounds.mockReturnValue(
            new DOMRect(
              attribution.canvasBounds.right + 1,
              creditBounds.y,
              250,
              24,
            ),
          );
        } else {
          attribution.creditBounds.mockReturnValue(
            new DOMRect(
              creditBounds.x,
              attribution.canvasBounds.bottom + 1,
              250,
              24,
            ),
          );
        }
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(entries);
        act(() => mockEventHandlers.get('load')?.());
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
        expect(map.getPadding().bottom).toBe(32);
      });

      it.each([
        {
          width: 390,
          height: 120,
          expected: { top: 80, right: 32, bottom: 38, left: 32 },
        },
        {
          width: 390,
          height: 100,
          expected: { top: 66, right: 32, bottom: 32, left: 32 },
        },
        {
          width: 40,
          height: 30,
          expected: { top: 14, right: 19, bottom: 14, left: 19 },
        },
      ])(
        'clamps expanded-credit padding safely in a $width×$height canvas',
        async ({ width, height, expected }) => {
          const map = createMapMock({ width, height });
          addAttributionControl(map, 60);
          mockMapConstructor.mockReturnValue(map);
          renderBuilderMap(entries);
          act(() => mockEventHandlers.get('load')?.());
          await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
          expect(map.getPadding()).toEqual(expected);
          expect(expected.top + expected.bottom).toBeLessThanOrEqual(
            height - 2,
          );
          expect(expected.left + expected.right).toBeLessThanOrEqual(width - 2);
        },
      );

      it('refits expanded and collapsed credits once without a canvas resize, but ignores unchanged bounds and selection', async () => {
        const map = createMapMock();
        const attribution = addAttributionControl(map);
        mockMapConstructor.mockReturnValue(map);
        const { props, rerender } = renderBuilderMap(entries);
        act(() => mockEventHandlers.get('load')?.());
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
        const observer = observers.at(-1)!;
        expect(observer.observe).toHaveBeenCalledWith(attribution.element);
        expect(map.getPadding().bottom).toBe(56);
        map.fitBounds.mockClear();

        attribution.setCreditHeight(60);
        act(() => {
          observer.notify();
          observer.notify();
        });
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
        expect(map.getPadding().bottom).toBe(92);
        expect(map.getContainer().clientWidth).toBe(1000);
        expect(map.getContainer().clientHeight).toBe(752);
        map.fitBounds.mockClear();
        map.resize.mockClear();

        rerender(
          <AtlasMap {...props} builderSelectedEntryIds={[entries[0].id]} />,
        );
        rerender(
          <AtlasMap
            {...props}
            entries={[entries[1], entries[0]]}
            builderSelectedEntryIds={[entries[0].id]}
          />,
        );
        act(() => observer.notify());
        await waitFor(() => expect(map.resize).toHaveBeenCalled());
        expect(map.fitBounds).not.toHaveBeenCalled();

        attribution.setCreditHeight(24);
        act(() => observer.notify());
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
        expect(map.getPadding().bottom).toBe(56);
      });

      it('does not refit when the canvas and credits move together without a relative-layout change', async () => {
        const map = createMapMock();
        const attribution = addAttributionControl(map);
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(entries);
        act(() => mockEventHandlers.get('load')?.());
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
        const creditBounds = attribution.element.getBoundingClientRect();
        attribution.containerBounds.mockReturnValue(
          new DOMRect(50, 200, 1000, 752),
        );
        attribution.creditBounds.mockReturnValue(
          new DOMRect(
            creditBounds.x,
            creditBounds.y + 100,
            creditBounds.width,
            creditBounds.height,
          ),
        );
        map.fitBounds.mockClear();
        map.resize.mockClear();
        act(() => observers.at(-1)?.notify());
        await waitFor(() => expect(map.resize).toHaveBeenCalled());
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.getPadding().bottom).toBe(56);
      });

      it('ignores attribution-only resize callbacks in ordinary Places mode', async () => {
        const map = createMapMock();
        const attribution = addAttributionControl(map);
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(entries, { builderActive: false });
        act(() => mockEventHandlers.get('load')?.());
        attribution.setCreditHeight(60);
        map.resize.mockClear();
        act(() => observers.at(-1)?.notify());
        await waitFor(() => expect(map.resize).toHaveBeenCalled());
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.getPadding()).toEqual({
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        });
      });

      it('disconnects the attribution observer and cancels pending resize work on unmount', () => {
        jest.useFakeTimers();
        const map = createMapMock();
        addAttributionControl(map);
        mockMapConstructor.mockReturnValue(map);
        const { unmount } = renderBuilderMap(entries);
        act(() => mockEventHandlers.get('load')?.());
        act(() => jest.runOnlyPendingTimers());
        map.fitBounds.mockClear();
        map.resize.mockClear();
        const observer = observers.at(-1)!;
        act(() => observer.notify());
        unmount();
        act(() => jest.runOnlyPendingTimers());
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(map.remove).toHaveBeenCalledTimes(1);
        expect(map.resize).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
      });
    });

    it.each([false, true])(
      'initializes double-tap zoom for builderActive=%s without changing pinch zoom',
      (builderActive) => {
        const map = createMapMock();
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(entries, { builderActive });
        expect(mockMapConstructor).toHaveBeenCalledWith(
          expect.objectContaining({
            doubleClickZoom: !builderActive,
            touchZoomRotate: true,
          }),
        );
        act(() => mockEventHandlers.get('load')?.());
        if (builderActive) {
          expect(map.doubleClickZoom.disable).toHaveBeenCalled();
          expect(map.doubleClickZoom.enable).not.toHaveBeenCalled();
        } else {
          expect(map.doubleClickZoom.enable).toHaveBeenCalled();
          expect(map.doubleClickZoom.disable).not.toHaveBeenCalled();
        }
        expect(map.touchZoomRotate.disable).not.toHaveBeenCalled();
        expect(map.touchZoomRotate.enable).not.toHaveBeenCalled();
        expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(1);
      },
    );

    it('disables double-tap zoom once on entry, keeps it disabled through selection, and restores it on exit', () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries, {
        builderActive: false,
      });
      act(() => mockEventHandlers.get('load')?.());
      map.doubleClickZoom.disable.mockClear();
      map.doubleClickZoom.enable.mockClear();
      const rotationDisableCount =
        map.touchZoomRotate.disableRotation.mock.calls.length;

      rerender(<AtlasMap {...props} builderActive />);
      expect(map.doubleClickZoom.disable).toHaveBeenCalledTimes(1);
      expect(map.doubleClickZoom.enable).not.toHaveBeenCalled();

      rerender(
        <AtlasMap
          {...props}
          builderActive
          builderSelectedEntryIds={[entries[0].id]}
        />,
      );
      rerender(
        <AtlasMap {...props} builderActive builderSelectedEntryIds={[]} />,
      );
      expect(map.doubleClickZoom.disable).toHaveBeenCalledTimes(1);
      expect(map.doubleClickZoom.enable).not.toHaveBeenCalled();

      rerender(<AtlasMap {...props} builderActive={false} />);
      expect(map.doubleClickZoom.enable).toHaveBeenCalledTimes(1);
      expect(map.doubleClickZoom.disable).toHaveBeenCalledTimes(1);
      expect(map.touchZoomRotate.disable).not.toHaveBeenCalled();
      expect(map.touchZoomRotate.enable).not.toHaveBeenCalled();
      expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(
        rotationDisableCount,
      );
    });

    it('fits eligible memories inside the actual canvas when entering and resizing the builder', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries, {
        builderActive: false,
      });
      act(() => mockEventHandlers.get('load')?.());
      expect(map.fitBounds).not.toHaveBeenCalled();

      rerender(<AtlasMap {...props} builderActive />);
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
      expect(map.getPadding()).toEqual({
        top: 80,
        right: 32,
        bottom: 32,
        left: 32,
      });
      expect(map.fitBounds).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ padding: 0, maxZoom: 8, duration: 950 }),
      );
      expect(mockBoundsExtends.at(-1)?.mock.calls).toEqual([
        [[-83, 42]],
        [[2, 49]],
      ]);

      map.fitBounds.mockClear();
      Object.defineProperties(map.getContainer(), {
        clientWidth: { configurable: true, value: 640 },
        clientHeight: { configurable: true, value: 480 },
      });
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
      expect(map.getPadding()).toEqual({
        top: 80,
        right: 32,
        bottom: 32,
        left: 32,
      });

      map.fitBounds.mockClear();
      map.resize.mockClear();
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(map.resize).toHaveBeenCalled());
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('temporarily allows letterboxed world-scale fits without changing normal Places constraints', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries);
      expect(mockMapConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ minZoom: -2 }),
      );
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.setMinZoom).toHaveBeenCalledWith(-2));
      const constrainCamera = map.setTransformConstrain.mock.calls.at(
        -1,
      )?.[0] as
        | ((center: { lng: number; lat: number }, zoom: number) => unknown)
        | undefined;
      expect(constrainCamera?.({ lng: 181, lat: 90 }, -10)).toEqual({
        center: { lng: 181, lat: 85.0511287798066 },
        zoom: -2,
      });

      rerender(<AtlasMap {...props} builderActive={false} />);
      await waitFor(() => expect(map.setMinZoom).toHaveBeenLastCalledWith(1));
      expect(map.setTransformConstrain).toHaveBeenLastCalledWith(null);
      expect(map.getPadding()).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
    });

    it('ignores stale memory focus and drawer insets while the builder is active', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries, {
        selectedId: entries[0].id,
        focusRequest: { id: entries[0].id, nonce: 4 },
        fitRequest: 2,
      });
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      expect(map.easeTo).not.toHaveBeenCalled();
      expect(map.getPadding()).toEqual({
        top: 80,
        right: 32,
        bottom: 32,
        left: 32,
      });
      map.fitBounds.mockClear();

      rerender(
        <AtlasMap
          {...props}
          selectedId={entries[1].id}
          focusRequest={{ id: entries[1].id, nonce: 5 }}
          builderSelectedEntryIds={[entries[0].id]}
        />,
      );
      expect(map.easeTo).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('keeps builder selection feature state and clustering without moving the camera', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries, {
        builderSelectedEntryIds: [entries[0].id],
      });
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      expect(map.addSource).toHaveBeenCalledWith(
        ATLAS_SOURCE_ID,
        expect.objectContaining({ cluster: true, clusterRadius: 58 }),
      );
      expect(map.setFeatureState).toHaveBeenCalledWith(
        { source: ATLAS_SOURCE_ID, id: entries[0].id },
        { builderSelected: true },
      );
      const source = map.getSource(ATLAS_SOURCE_ID);
      source?.setData.mockClear();
      map.fitBounds.mockClear();
      map.easeTo.mockClear();
      map.setFeatureState.mockClear();

      rerender(
        <AtlasMap {...props} builderSelectedEntryIds={[entries[1].id]} />,
      );
      expect(map.setFeatureState).toHaveBeenCalledWith(
        { source: ATLAS_SOURCE_ID, id: entries[0].id },
        { builderSelected: false },
      );
      expect(map.setFeatureState).toHaveBeenCalledWith(
        { source: ATLAS_SOURCE_ID, id: entries[1].id },
        { builderSelected: true },
      );
      expect(source?.setData).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(map.easeTo).not.toHaveBeenCalled();
    });

    it('refits changed eligible geometry but not reordering or metadata enrichment', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries);
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      map.fitBounds.mockClear();

      rerender(<AtlasMap {...props} entries={[entries[1], entries[0]]} />);
      expect(map.fitBounds).not.toHaveBeenCalled();

      const reorderedEntries = [
        {
          ...entries[1],
          title: 'An enriched Paris memory',
          description: 'New copy',
        },
        { ...entries[0], placeLabel: 'Detroit, United States' },
      ];
      rerender(<AtlasMap {...props} entries={reorderedEntries} />);
      expect(map.fitBounds).not.toHaveBeenCalled();

      const movedEntries = [
        { ...reorderedEntries[0], longitude: 3 },
        reorderedEntries[1],
      ];
      rerender(<AtlasMap {...props} entries={movedEntries} />);
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
      expect(mockBoundsExtends.at(-1)?.mock.calls).toContainEqual([[3, 49]]);

      map.fitBounds.mockClear();
      rerender(<AtlasMap {...props} entries={movedEntries} fitRequest={1} />);
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    });

    it('excludes unfinished, future, and nonfinite entries from the builder overview', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      renderBuilderMap([
        ...entries,
        createEntry('draft', { recordState: 'draft', longitude: 130 }),
        createEntry('future', {
          journeyState: 'want_to_visit',
          longitude: -130,
        }),
        createEntry('invalid', { latitude: Number.NaN }),
      ]);
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      expect(mockBoundsExtends.at(-1)?.mock.calls).toEqual([
        [[-83, 42]],
        [[2, 49]],
      ]);
    });

    it('fits date-line memories in their minimal point envelope rather than across the world', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      renderBuilderMap([
        createEntry('fiji', { longitude: 179, latitude: -17 }),
        createEntry('samoa', { longitude: -179, latitude: -14 }),
      ]);
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      const coordinates = mockBoundsExtends
        .at(-1)!
        .mock.calls.map(([coordinate]) => coordinate as [number, number]);
      const longitudes = coordinates.map(([longitude]) => longitude);
      expect(Math.max(...longitudes) - Math.min(...longitudes)).toBe(2);
      expect(coordinates.map(([, latitude]) => latitude)).toEqual([-17, -14]);
    });

    it('caps a globe builder fit using the exposed canvas and point geometry', async () => {
      const map = createMapMock();
      map.setProjection({ type: 'globe' });
      map.cameraForBounds.mockReturnValue({
        center: [0, 70],
        zoom: 4,
        bearing: 0,
      });
      mockMapConstructor.mockReturnValue(map);
      const globeEntries = [
        createEntry('west', { longitude: -75, latitude: 40 }),
        createEntry('east', { longitude: 75, latitude: 40 }),
      ];
      renderBuilderMap(globeEntries);
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      const expectedLimit = getAtlasJourneyGlobeFitZoomLimit(
        globeEntries.map((entry) => [entry.longitude, entry.latitude]),
        1000,
        752,
        { top: 80, right: 32, bottom: 32, left: 32 },
        [0, 70],
        map.getVerticalFieldOfView(),
      );
      expect(expectedLimit).not.toBeNull();
      expect(map.fitBounds).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: expectedLimit }),
      );
      expect(map.setTransformConstrain).toHaveBeenLastCalledWith(null);
    });

    it.each([
      { entries: [] as AtlasEntry[], center: [-18, 22], zoom: 1.65 },
      { entries: [entries[0]], center: [-83, 42], zoom: 6 },
    ])(
      'uses a padded fallback for $entries.length builder memories',
      async (example) => {
        const map = createMapMock({ width: 40, height: 30 });
        mockMapConstructor.mockReturnValue(map);
        renderBuilderMap(example.entries);
        act(() => mockEventHandlers.get('load')?.());
        await waitFor(() => expect(map.easeTo).toHaveBeenCalled());
        expect(map.easeTo).toHaveBeenLastCalledWith(
          expect.objectContaining({
            center: example.center,
            zoom: example.zoom,
            padding: { top: 14, right: 19, bottom: 14, left: 19 },
          }),
        );
        expect(map.fitBounds).not.toHaveBeenCalled();
      },
    );

    it('honors reduced motion for builder bounds fits', async () => {
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
      renderBuilderMap(entries);
      act(() => mockEventHandlers.get('load')?.());
      await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
      expect(map.fitBounds).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ duration: 0 }),
      );
    });

    it('selects the nearest eligible pin within the buffered target exactly once', async () => {
      const map = createMapMock();
      const nearbyEntries = [
        createEntry('farther', { longitude: 118, latitude: 40 }),
        createEntry('nearest', { longitude: 108, latitude: 40 }),
      ];
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER)
          ? []
          : nearbyEntries.map(placeFeature),
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap(nearbyEntries, { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      const event = {
        point: { x: 100, y: 40 },
        features: [placeFeature(nearbyEntries[1])],
      };
      act(() => delegatedHandler(map, 'mouseenter', ATLAS_PIN_LAYER)(event));
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      act(() => {
        mockEventHandlers.get('click')?.(event);
        delegatedHandler(map, 'click', ATLAS_PIN_LAYER)(event);
      });
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(event.point, {
        layers: [ATLAS_CLUSTER_LAYER],
      });
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [78, 18],
          [122, 62],
        ],
        { layers: [ATLAS_PIN_LAYER] },
      );
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('nearest');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('resolves duplicate world copies relative to the live camera center', () => {
      const map = createMapMock();
      map.getCenter.mockReturnValue({ lng: 181, lat: 0 });
      map.project.mockImplementation((coordinate) => {
        const [longitude, latitude] = Array.isArray(coordinate)
          ? coordinate
          : [coordinate.lng, coordinate.lat];
        return { x: longitude - 80, y: latitude };
      });
      const wrappedEntry = createEntry('wrapped', {
        longitude: -179,
        latitude: 40,
      });
      const duplicate = placeFeature(wrappedEntry);
      duplicate.geometry.coordinates = [181, 40];
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER)
          ? []
          : [placeFeature(wrappedEntry), duplicate],
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap([wrappedEntry], { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() => mockEventHandlers.get('click')?.({ point: { x: 100, y: 40 } }));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('wrapped');
      expect(map.project).toHaveBeenCalledWith([181, 40]);
    });

    it.each([901, -899])(
      'selects a pin in the clicked %i-degree world copy far from the camera center',
      (clickedLongitude) => {
        const map = createMapMock();
        map.unproject.mockReturnValue({ lng: clickedLongitude, lat: 40 });
        map.project.mockImplementation((coordinate) => {
          const [longitude, latitude] = Array.isArray(coordinate)
            ? coordinate
            : [coordinate.lng, coordinate.lat];
          return { x: longitude - clickedLongitude + 100, y: latitude };
        });
        const entry = createEntry('far-world-copy', {
          longitude: -179,
          latitude: 40,
        });
        map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
          layers.includes(ATLAS_CLUSTER_LAYER) ? [] : [placeFeature(entry)],
        );
        mockMapConstructor.mockReturnValue(map);
        const onSelect = jest.fn();
        renderBuilderMap([entry], { onSelect });
        act(() => mockEventHandlers.get('load')?.());
        const point = { x: 100, y: 40 };
        act(() => mockEventHandlers.get('click')?.({ point }));
        expect(map.unproject).toHaveBeenCalledWith(point);
        expect(map.getCenter()).toEqual({ lng: 0, lat: 0 });
        expect(map.project).toHaveBeenCalledWith([clickedLongitude, 40]);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(entry.id);
      },
    );

    it('falls back to the live camera world copy if click unprojection throws', () => {
      const map = createMapMock();
      map.getCenter.mockReturnValue({ lng: 181, lat: 0 });
      map.unproject.mockImplementation(() => {
        throw new Error('Transient click unprojection failure');
      });
      map.project.mockImplementation((coordinate) => {
        const [longitude, latitude] = Array.isArray(coordinate)
          ? coordinate
          : [coordinate.lng, coordinate.lat];
        return { x: longitude - 81, y: latitude };
      });
      const entry = createEntry('camera-fallback', {
        longitude: -179,
        latitude: 40,
      });
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER) ? [] : [placeFeature(entry)],
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap([entry], { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() => mockEventHandlers.get('click')?.({ point: { x: 100, y: 40 } }));
      expect(map.project).toHaveBeenCalledWith([181, 40]);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(entry.id);
    });

    it('considers a later rendered copy of an ID when its first copy misses the target', () => {
      const map = createMapMock();
      map.project.mockImplementation((coordinate) => {
        const [longitude, latitude] = Array.isArray(coordinate)
          ? coordinate
          : [coordinate.lng, coordinate.lat];
        return { x: longitude, y: 100 + (latitude - 40) * 50 };
      });
      const entry = createEntry('entry-a', { longitude: 100, latitude: 40 });
      const competitor = createEntry('entry-b', {
        longitude: 110,
        latitude: 40,
      });
      const firstCopy = placeFeature(entry);
      firstCopy.geometry.coordinates = [100, 50];
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER)
          ? []
          : [firstCopy, placeFeature(competitor), placeFeature(entry)],
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap([entry, competitor], { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() =>
        mockEventHandlers.get('click')?.({ point: { x: 100, y: 100 } }),
      );
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(entry.id);
    });

    it.each([86, 90, -86, -90])(
      'selects a painted polar pin saved at %i degrees across equivalent world copies',
      (savedLatitude) => {
        const map = createMapMock();
        const paintedLatitude = Math.sign(savedLatitude) * 85.0511287798066;
        map.getCenter.mockReturnValue({ lng: 181, lat: 0 });
        map.project.mockImplementation((coordinate) => {
          const [longitude, latitude] = Array.isArray(coordinate)
            ? coordinate
            : [coordinate.lng, coordinate.lat];
          // A realistic high-zoom separation: even 86 degrees is more than
          // 22px from the Mercator cap; the painted pin stays on the canvas.
          return {
            x: longitude - 81,
            y: 100 + (latitude - paintedLatitude) * 50,
          };
        });
        const entry = createEntry('polar', {
          longitude: -179,
          latitude: savedLatitude,
        });
        const paintedFeature = placeFeature(entry);
        paintedFeature.geometry.coordinates = [181, paintedLatitude];
        const duplicate = placeFeature(entry);
        duplicate.geometry.coordinates = [-179, paintedLatitude];
        map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
          layers.includes(ATLAS_CLUSTER_LAYER)
            ? []
            : [paintedFeature, duplicate],
        );
        mockMapConstructor.mockReturnValue(map);
        const onSelect = jest.fn();
        renderBuilderMap([entry], { onSelect });
        act(() => mockEventHandlers.get('load')?.());
        act(() =>
          mockEventHandlers.get('click')?.({ point: { x: 100, y: 100 } }),
        );
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(entry.id);
        expect(map.project).toHaveBeenCalledWith([181, paintedLatitude]);
        expect(
          map.project.mock.calls.every(
            ([coordinate]) =>
              (Array.isArray(coordinate) ? coordinate[1] : coordinate.lat) ===
              paintedLatitude,
          ),
        ).toBe(true);
      },
    );

    it.each(
      [86, 90, -86, -90].flatMap((savedLatitude) =>
        [
          { kind: 'missing geometry', geometry: undefined },
          {
            kind: 'nonpoint geometry',
            geometry: {
              type: 'LineString',
              coordinates: [[-179, savedLatitude]],
            },
          },
          {
            kind: 'nonfinite latitude',
            geometry: { type: 'Point', coordinates: [-179, Number.NaN] },
          },
          {
            kind: 'nonfinite longitude',
            geometry: {
              type: 'Point',
              coordinates: [Number.POSITIVE_INFINITY, savedLatitude],
            },
          },
        ].map((example) => ({ ...example, savedLatitude })),
      ),
    )(
      'clamps the saved $savedLatitude-degree pin fallback for $kind',
      ({ savedLatitude, geometry }) => {
        const map = createMapMock();
        const paintedLatitude = Math.sign(savedLatitude) * 85.0511287798066;
        map.getCenter.mockReturnValue({ lng: 181, lat: 0 });
        map.project.mockImplementation((coordinate) => {
          const [longitude, latitude] = Array.isArray(coordinate)
            ? coordinate
            : [coordinate.lng, coordinate.lat];
          return {
            x: longitude - 81,
            y: 100 + (latitude - paintedLatitude) * 50,
          };
        });
        const entry = createEntry('polar-fallback', {
          longitude: -179,
          latitude: savedLatitude,
        });
        // Deliberately model an unusable public geometry, including malformed
        // data, to exercise the saved-coordinate fallback defensively.
        const feature = {
          ...placeFeature(entry),
          geometry,
        } as unknown as RenderedPlaceFeature;
        map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
          layers.includes(ATLAS_CLUSTER_LAYER) ? [] : [feature],
        );
        mockMapConstructor.mockReturnValue(map);
        const onSelect = jest.fn();
        renderBuilderMap([entry], { onSelect });
        act(() => mockEventHandlers.get('load')?.());
        act(() =>
          mockEventHandlers.get('click')?.({ point: { x: 100, y: 100 } }),
        );
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith(entry.id);
        expect(map.project).toHaveBeenCalledWith([181, paintedLatitude]);
      },
    );

    it('uses stable ID order to break equally close pin ties', () => {
      const map = createMapMock();
      const tiedEntries = [
        createEntry('entry-b', { longitude: 110, latitude: 40 }),
        createEntry('entry-a', { longitude: 90, latitude: 40 }),
      ];
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER)
          ? []
          : tiedEntries.map(placeFeature),
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap(tiedEntries, { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() => mockEventHandlers.get('click')?.({ point: { x: 100, y: 40 } }));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('entry-a');
    });

    it('rejects stale, ineligible, and square-corner buffered hits outside the circular target', () => {
      const map = createMapMock();
      const rejectedEntries = [
        createEntry('draft', {
          recordState: 'draft',
          longitude: 100,
          latitude: 40,
        }),
        createEntry('future', {
          journeyState: 'want_to_visit',
          longitude: 100,
          latitude: 40,
        }),
        createEntry('corner', { longitude: 120, latitude: 60 }),
      ];
      const staleEntry = createEntry('stale', { longitude: 100, latitude: 40 });
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER)
          ? []
          : [placeFeature(staleEntry), ...rejectedEntries.map(placeFeature)],
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap(rejectedEntries, { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() => mockEventHandlers.get('click')?.({ point: { x: 100, y: 40 } }));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it.each([
      { distance: 22, selected: true },
      { distance: 22.01, selected: false },
    ])('uses an inclusive 22px circular target at $distance px', (example) => {
      const map = createMapMock();
      const entry = createEntry('edge', {
        longitude: 100 + example.distance,
        latitude: 40,
      });
      map.queryRenderedFeatures.mockImplementation((_point, { layers }) =>
        layers.includes(ATLAS_CLUSTER_LAYER) ? [] : [placeFeature(entry)],
      );
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap([entry], { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      act(() => mockEventHandlers.get('click')?.({ point: { x: 100, y: 40 } }));
      expect(onSelect).toHaveBeenCalledTimes(example.selected ? 1 : 0);
    });

    it('lets an exact cluster click expand before considering buffered pins', async () => {
      const map = createMapMock();
      const cluster: RenderedPlaceFeature = {
        type: 'Feature',
        properties: { cluster_id: 7, point_count: 2 },
        geometry: { type: 'Point', coordinates: [100, 40] },
      };
      map.queryRenderedFeatures.mockReturnValue([cluster]);
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap(entries, { onSelect });
      act(() => mockEventHandlers.get('load')?.());
      map.easeTo.mockClear();
      const event = { point: { x: 100, y: 40 }, features: [cluster] };
      act(() => mockEventHandlers.get('click')?.(event));
      expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
      expect(onSelect).not.toHaveBeenCalled();
      await act(async () =>
        delegatedHandler(map, 'click', ATLAS_CLUSTER_LAYER)(event),
      );
      expect(
        map.getSource(ATLAS_SOURCE_ID)?.getClusterExpansionZoom,
      ).toHaveBeenCalledWith(7);
      expect(map.easeTo).toHaveBeenLastCalledWith(
        expect.objectContaining({ center: [100, 40], zoom: 9, duration: 700 }),
      );
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('describes adding and removing memories instead of opening the drawer', () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const { props, rerender } = renderBuilderMap(entries);
      act(() => mockEventHandlers.get('load')?.());
      const event = {
        point: { x: 100, y: 40 },
        features: [placeFeature(entries[0])],
      };
      act(() => delegatedHandler(map, 'mouseenter', ATLAS_PIN_LAYER)(event));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Add to journey');
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Click to select for journey',
      );
      expect(screen.getByRole('tooltip')).not.toHaveTextContent('Open memory');
      const mapRegion = screen.getByRole('region', {
        name: /journey.*map|map.*journey/i,
      });
      expect(mapRegion).toHaveAccessibleDescription(/select|add/i);

      rerender(
        <AtlasMap {...props} builderSelectedEntryIds={[entries[0].id]} />,
      );
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Selected for journey',
      );
      expect(screen.getByRole('tooltip')).toHaveTextContent(
        'Click to remove from journey',
      );
    });

    it('keeps ordinary Places pin clicks, tooltip copy, zoom floor, and resize behavior unchanged', async () => {
      const map = createMapMock();
      mockMapConstructor.mockReturnValue(map);
      const onSelect = jest.fn();
      renderBuilderMap(entries, { builderActive: false, onSelect });
      expect(mockMapConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ minZoom: 1 }),
      );
      act(() => mockEventHandlers.get('load')?.());
      const event = {
        point: { x: 100, y: 40 },
        features: [placeFeature(entries[0])],
      };
      act(() => delegatedHandler(map, 'mouseenter', ATLAS_PIN_LAYER)(event));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Remembered place');
      expect(screen.getByRole('tooltip')).toHaveTextContent('Open memory');
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      act(() => mockEventHandlers.get('click')?.(event));
      expect(onSelect).not.toHaveBeenCalled();
      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
      act(() => delegatedHandler(map, 'click', ATLAS_PIN_LAYER)(event));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(entries[0].id);

      Object.defineProperty(map.getContainer(), 'clientWidth', {
        configurable: true,
        value: 640,
      });
      map.resize.mockClear();
      fireEvent(window, new Event('resize'));
      await waitFor(() => expect(map.resize).toHaveBeenCalled());
      expect(map.fitBounds).not.toHaveBeenCalled();
    });
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
