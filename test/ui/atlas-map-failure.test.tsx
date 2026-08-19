/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import AtlasMap from '@/components/atlas/atlas-map';

jest.mock('maplibre-gl', () => ({
  __esModule: true,
  default: {
    Map: jest.fn(() => {
      throw new Error('WebGL context unavailable');
    }),
    AttributionControl: jest.fn(),
    ScaleControl: jest.fn(),
  },
  LngLatBounds: jest.fn(),
}));

describe('Atlas map failure recovery', () => {
  it('keeps the route alive when a mobile WebGL context cannot be created', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    render(
      <AtlasMap
        entries={[]}
        initialView={{
          latitude: 22,
          longitude: -18,
          zoom: 1.65,
          bearing: 0,
          pitch: 0,
        }}
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

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The map is taking the long way around.',
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Atlas map initialization failed:',
      expect.any(Error),
    );
  });
});
