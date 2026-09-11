import {
  featureFilter,
  type FilterSpecification,
} from '@maplibre/maplibre-gl-style-spec';
import type { TransformStyleFunction } from 'maplibre-gl';

import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';

type Style = Parameters<TransformStyleFunction>[1];

function createStyle(filter: unknown): Style {
  return {
    version: 8,
    sources: {
      'test-source': {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      {
        id: 'test-layer',
        type: 'line',
        source: 'test-source',
        filter: filter as never,
        paint: { 'line-color': '#000000' },
      },
    ],
  };
}

function firstLayerFilter(style: Style) {
  return (style.layers[0] as { filter?: unknown }).filter;
}

describe('OpenFreeMap style sanitizer', () => {
  it.each([
    ['admin_level', '>=', 3],
    ['admin_level', '<=', 6],
    ['ref_length', '<=', 6],
  ])(
    'guards nullable %s numeric comparisons without changing the comparison',
    (property, operator, boundary) => {
      const comparison = [operator, ['get', property], boundary];
      const style = createStyle(['all', comparison, ['has', 'name']]);

      const sanitized = sanitizeOpenFreeMapStyle(undefined, style);

      expect(firstLayerFilter(sanitized)).toEqual([
        'all',
        ['all', ['==', ['typeof', ['get', property]], 'number'], comparison],
        ['has', 'name'],
      ]);
      expect(firstLayerFilter(style)).toEqual([
        'all',
        comparison,
        ['has', 'name'],
      ]);
    },
  );

  it('guards a nullable property on the right side of a comparison', () => {
    const style = createStyle(['<', 0, ['get', 'ref_length']]);

    const sanitized = sanitizeOpenFreeMapStyle(undefined, style);

    expect(firstLayerFilter(sanitized)).toEqual([
      'all',
      ['==', ['typeof', ['get', 'ref_length']], 'number'],
      ['<', 0, ['get', 'ref_length']],
    ]);
  });

  it.each(['admin_level', 'ref_length'])(
    'evaluates missing, null, and malformed %s values without warning',
    (property) => {
      const style = createStyle(['<=', ['get', property], 6]);
      const sanitized = sanitizeOpenFreeMapStyle(undefined, style);
      const filter = featureFilter(
        firstLayerFilter(sanitized) as FilterSpecification,
        'layers[0].filter',
      ).filter;
      const consoleWarning = jest.spyOn(console, 'warn');

      expect(filter({ zoom: 5 }, { properties: {} } as never)).toBe(false);
      expect(
        filter({ zoom: 5 }, { properties: { [property]: null } } as never),
      ).toBe(false);
      expect(
        filter({ zoom: 5 }, { properties: { [property]: '6' } } as never),
      ).toBe(false);
      expect(
        filter({ zoom: 5 }, { properties: { [property]: 6 } } as never),
      ).toBe(true);
      expect(consoleWarning).not.toHaveBeenCalled();
      consoleWarning.mockRestore();
    },
  );

  it.each([
    ['keeps equality comparisons intact', ['==', ['get', 'admin_level'], 2]],
    ['keeps string comparisons intact', ['<', ['get', 'ref_length'], '7']],
    ['keeps unrelated numeric filters intact', ['>=', ['get', 'rank'], 3]],
  ])('%s', (_label, filter) => {
    const style = createStyle(filter);

    expect(sanitizeOpenFreeMapStyle(undefined, style)).toBe(style);
  });

  it('sanitizes expressions nested in layer paint values', () => {
    const style = createStyle(true);
    style.layers[0] = {
      id: 'test-circle',
      type: 'circle',
      source: 'test-source',
      paint: {
        'circle-radius': ['case', ['<=', ['get', 'ref_length'], 6], 4, 2],
      },
    };

    const sanitized = sanitizeOpenFreeMapStyle(undefined, style);

    expect(sanitized.layers[0]).toEqual({
      id: 'test-circle',
      type: 'circle',
      source: 'test-source',
      paint: {
        'circle-radius': [
          'case',
          [
            'all',
            ['==', ['typeof', ['get', 'ref_length']], 'number'],
            ['<=', ['get', 'ref_length'], 6],
          ],
          4,
          2,
        ],
      },
    });
  });

  it('is idempotent when an already-sanitized style is transformed again', () => {
    const style = createStyle([
      'all',
      ['>=', ['get', 'admin_level'], 3],
      ['<=', ['get', 'ref_length'], 6],
    ]);

    const sanitized = sanitizeOpenFreeMapStyle(undefined, style);

    expect(sanitizeOpenFreeMapStyle(undefined, sanitized)).toBe(sanitized);
  });
});
