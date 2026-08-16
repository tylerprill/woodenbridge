import type {
  CircleLayerSpecification,
  GeoJSONSource,
  Map,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';

export const ATLAS_SOURCE_ID = 'field-atlas-memories';
export const ATLAS_CLUSTER_LAYER = 'field-atlas-clusters';
export const ATLAS_CLUSTER_COUNT_LAYER = 'field-atlas-cluster-count';
export const ATLAS_PIN_HALO_LAYER = 'field-atlas-pin-halo';
export const ATLAS_PIN_LAYER = 'field-atlas-pins';
export const ATLAS_INTERACTIVE_LAYERS = [ATLAS_CLUSTER_LAYER, ATLAS_PIN_LAYER];

export function entriesToGeoJson(
  entries: AtlasEntry[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries.map((entry) => ({
      type: 'Feature',
      id: entry.id,
      geometry: {
        type: 'Point',
        coordinates: [entry.longitude, entry.latitude],
      },
      properties: {
        id: entry.id,
        title: entry.title || 'Untitled place',
        placeLabel: entry.placeLabel || 'Pinned place',
        recordState: entry.recordState,
        journeyState: entry.journeyState,
      },
    })),
  };
}

const unclusteredFilter: CircleLayerSpecification['filter'] = [
  '!',
  ['has', 'point_count'],
];

export function addAtlasLayers(map: Map, entries: AtlasEntry[]) {
  if (!map.getSource(ATLAS_SOURCE_ID)) {
    map.addSource(ATLAS_SOURCE_ID, {
      type: 'geojson',
      data: entriesToGeoJson(entries),
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 58,
      promoteId: 'id',
    });
  }

  const clusterShadow: CircleLayerSpecification = {
    id: `${ATLAS_CLUSTER_LAYER}-shadow`,
    type: 'circle',
    source: ATLAS_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 22, 10, 27, 40, 33],
      'circle-color': 'rgba(16, 35, 29, 0.2)',
      'circle-blur': 0.7,
      'circle-translate': [0, 5],
    },
  };

  const clusters: CircleLayerSpecification = {
    id: ATLAS_CLUSTER_LAYER,
    type: 'circle',
    source: ATLAS_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': [
        '+',
        ['step', ['get', 'point_count'], 18, 10, 23, 40, 28],
        ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0],
      ],
      'circle-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#244238',
        '#10231d',
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        3,
        2,
      ],
      'circle-stroke-color': 'rgba(251, 250, 245, 0.92)',
      'circle-opacity': 0.96,
      'circle-radius-transition': { duration: 180, delay: 0 },
      'circle-color-transition': { duration: 180, delay: 0 },
      'circle-stroke-width-transition': { duration: 180, delay: 0 },
    },
  };

  const clusterCount: SymbolLayerSpecification = {
    id: ATLAS_CLUSTER_COUNT_LAYER,
    type: 'symbol',
    source: ATLAS_SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['Noto Sans Regular'],
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#fbfaf5',
    },
  };

  const pinHalo: CircleLayerSpecification = {
    id: ATLAS_PIN_HALO_LAYER,
    type: 'circle',
    source: ATLAS_SOURCE_ID,
    filter: unclusteredFilter,
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        23,
        ['boolean', ['feature-state', 'hover'], false],
        19,
        13,
      ],
      'circle-color': [
        'case',
        ['==', ['get', 'journeyState'], 'want_to_visit'],
        '#b8c8a4',
        '#e7b081',
      ],
      'circle-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        0.28,
        ['boolean', ['feature-state', 'hover'], false],
        0.2,
        0.1,
      ],
      'circle-blur': 0.35,
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        1.5,
        ['boolean', ['feature-state', 'hover'], false],
        1,
        0,
      ],
      'circle-stroke-color': 'rgba(251, 250, 245, 0.88)',
      'circle-radius-transition': { duration: 180, delay: 0 },
      'circle-opacity-transition': { duration: 180, delay: 0 },
    },
  };

  const pins: CircleLayerSpecification = {
    id: ATLAS_PIN_LAYER,
    type: 'circle',
    source: ATLAS_SOURCE_ID,
    filter: unclusteredFilter,
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        9.5,
        ['boolean', ['feature-state', 'hover'], false],
        8.5,
        6.5,
      ],
      'circle-color': [
        'case',
        ['==', ['get', 'recordState'], 'draft'],
        '#e7b081',
        ['==', ['get', 'journeyState'], 'want_to_visit'],
        '#4c6a5b',
        '#b66d42',
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        3,
        2,
      ],
      'circle-stroke-color': '#fbfaf5',
      'circle-opacity': 1,
      'circle-radius-transition': { duration: 160, delay: 0 },
      'circle-stroke-width-transition': { duration: 160, delay: 0 },
    },
  };

  [clusterShadow, clusters, clusterCount, pinHalo, pins].forEach((layer) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  });
}

export function updateAtlasSource(map: Map, entries: AtlasEntry[]) {
  const source = map.getSource(ATLAS_SOURCE_ID) as GeoJSONSource | undefined;
  if (source) source.setData(entriesToGeoJson(entries));
}
