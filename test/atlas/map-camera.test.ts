import { getAtlasFitPadding } from '@/components/atlas/atlas-map-camera';

describe('Atlas map camera padding', () => {
  it('fits safely inside the compact mobile journey map', () => {
    const padding = getAtlasFitPadding(320, 256);

    expect(padding).toEqual({
      top: 41,
      right: 38,
      bottom: 72,
      left: 38,
    });
    expect(padding.left + padding.right).toBeLessThan(320);
    expect(padding.top + padding.bottom).toBeLessThan(256);
  });

  it('preserves generous editorial padding on a desktop map', () => {
    expect(getAtlasFitPadding(1000, 752)).toEqual({
      top: 120,
      right: 120,
      bottom: 140,
      left: 120,
    });
  });

  it('never produces invalid padding for a zero-size transition frame', () => {
    expect(getAtlasFitPadding(0, 0)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
