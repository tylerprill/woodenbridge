import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function source(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('landing-page performance boundaries', () => {
  it('keeps MapLibre styles on map components instead of every route', () => {
    expect(source('app/layout.tsx')).not.toContain('maplibre-gl.css');
    expect(source('components/atlas/atlas-map.tsx')).toContain(
      'maplibre-gl/dist/maplibre-gl.css',
    );
    expect(source('components/chapters/chapter-map.tsx')).toContain(
      'maplibre-gl/dist/maplibre-gl.css',
    );
  });

  it('renders the decorative ambient layer without a client-side pointer loop', () => {
    const ambient = source('components/home/ambient-background.tsx');
    const css = source('app/global.css');
    const ambientKeyframes = css.match(
      /@keyframes ambient-float[\s\S]*?(?=@keyframes sun-breathe)/,
    )?.[0];

    expect(ambient).not.toContain("'use client'");
    expect(ambient).not.toContain('pointermove');
    expect(ambientKeyframes).toContain('transform: translate3d');
    expect(ambientKeyframes).not.toContain('margin:');
    expect(css).toMatch(
      /\.home-shell > \.ambient-background \{[\s\S]*?height: clamp\(48rem, 100svh, 60rem\);/,
    );
    expect(css).toMatch(
      /\.home-shell > \.ambient-background::after \{[\s\S]*?linear-gradient\(to bottom, transparent 72%, var\(--paper\) 100%\)/,
    );
  });

  it('keeps password verification out of the landing session graph', () => {
    expect(source('app/lib/auth/session.ts')).toContain(
      "from '@/auth.session'",
    );
    expect(source('app/lib/actions/auth.ts')).toContain(
      "from '@/auth.session'",
    );
    expect(source('auth.session-config.ts')).not.toContain('Credentials');
    expect(source('auth.ts')).toContain('Credentials(');
  });
});
