/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import type { AtlasView } from '@/app/lib/atlas/definitions';
import AtlasMap from '@/components/atlas/atlas-map';

const mockMapConstructor = jest.fn();
const mockEventHandlers = new Map<string, (event?: unknown) => void>();

jest.mock('maplibre-gl', () => ({
  __esModule: true,
  default: {
    Map: function MockMap(...args: unknown[]) {
      return mockMapConstructor(...args);
    },
    AttributionControl: jest.fn(),
    ScaleControl: jest.fn(),
  },
  LngLatBounds: jest.fn(),
}));

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
