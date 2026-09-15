/**
 * @jest-environment jsdom
 */

import { getMapFirstBuilderLayoutErrors } from '../../e2e/support/journey-audit';

jest.mock('@playwright/test', () => ({ expect: jest.fn() }));

function setBounds(element: Element, bounds: DOMRect) {
  jest.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
  jest
    .spyOn(element, 'getClientRects')
    .mockReturnValue(
      (bounds.width > 0 && bounds.height > 0
        ? [bounds]
        : []) as unknown as DOMRectList,
    );
}

function createBuilderLayout() {
  const map = document.createElement('div');
  map.className = 'maplibregl-map';
  const builder = document.createElement('section');
  builder.setAttribute('aria-labelledby', 'journey-builder-title');
  document.body.append(map, builder);
  setBounds(map, new DOMRect(100, 80, 600, 400));
  setBounds(builder, new DOMRect(700, 80, 320, 400));
  return { map, builder };
}

function addCredits(map: Element, bounds = new DOMRect(480, 440, 200, 24)) {
  const attribution = document.createElement('details');
  attribution.className = 'maplibregl-ctrl maplibregl-ctrl-attrib';
  attribution.textContent = 'Map attribution';
  map.append(attribution);
  setBounds(attribution, bounds);
  return attribution;
}

describe('Map-first builder layout audit', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('ignores MapLibre empty attribution hidden at the zero origin', () => {
    const { map } = createBuilderLayout();
    const attribution = addCredits(map, new DOMRect(0, 0, 0, 0));
    attribution.classList.add('maplibregl-attrib-empty');
    attribution.style.display = 'none';
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it('accepts a map without an attribution control', () => {
    createBuilderLayout();
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it.each([
    ['zero width', new DOMRect(0, 0, 0, 24)],
    ['zero height', new DOMRect(0, 0, 200, 0)],
  ])('ignores attribution with %s', (_name, bounds) => {
    const { map } = createBuilderLayout();
    addCredits(map, bounds);
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it.each([
    ['display none', 'display: none'],
    ['visibility hidden', 'visibility: hidden'],
    ['visibility collapse', 'visibility: collapse'],
    ['opacity zero', 'opacity: 0'],
  ])('ignores non-rendered attribution with %s', (_name, style) => {
    const { map } = createBuilderLayout();
    const attribution = addCredits(map, new DOMRect(0, 0, 200, 24));
    attribution.setAttribute('style', style);
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it('accepts visible credits completely inside the canvas', () => {
    const { map } = createBuilderLayout();
    addCredits(map);
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it.each([
    ['left edge', new DOMRect(98, 440, 200, 24)],
    ['right edge', new DOMRect(502, 440, 200, 24)],
    ['top edge', new DOMRect(480, 78, 200, 24)],
    ['bottom edge', new DOMRect(480, 458, 200, 24)],
  ])('still rejects visible credits beyond the %s', (_name, bounds) => {
    const { map } = createBuilderLayout();
    addCredits(map, bounds);
    expect(getMapFirstBuilderLayoutErrors()).toEqual([
      'Map credits extend outside the visible canvas',
    ]);
  });

  it('ignores an unrelated attribution control outside the current map', () => {
    createBuilderLayout();
    const unrelatedMap = document.createElement('div');
    document.body.prepend(unrelatedMap);
    addCredits(unrelatedMap, new DOMRect(0, 0, 200, 24));
    expect(getMapFirstBuilderLayoutErrors()).toEqual([]);
  });

  it('still rejects controls covering the map canvas', () => {
    const { builder } = createBuilderLayout();
    jest
      .spyOn(builder, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(650, 80, 320, 400));
    expect(getMapFirstBuilderLayoutErrors()).toEqual([
      'Builder controls cover the map canvas',
    ]);
  });

  it.each([
    ['width', new DOMRect(100, 80, 99, 400)],
    ['height', new DOMRect(100, 80, 600, 99)],
  ])('still rejects an unusably small canvas %s', (_name, bounds) => {
    const { map } = createBuilderLayout();
    jest.spyOn(map, 'getBoundingClientRect').mockReturnValue(bounds);
    expect(getMapFirstBuilderLayoutErrors()).toEqual([
      'Builder leaves no usable map area',
    ]);
  });

  it('reports a missing builder or map', () => {
    expect(getMapFirstBuilderLayoutErrors()).toEqual([
      'Builder or map is missing',
    ]);
  });
});
