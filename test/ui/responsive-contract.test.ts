import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('responsive and route-level UI contracts', () => {
  it('keeps compact Atlas controls inside the viewport flow', () => {
    const css = readFileSync(
      join(root, 'components/atlas/atlas.module.css'),
      'utf8',
    );
    const mobile = css.match(
      /@media \(max-width: 760px\) \{[\s\S]*?\.workspace \{([\s\S]*?)\n  \}/,
    )?.[1];

    expect(mobile).toContain('height: calc(100svh - 5.5rem)');
    expect(mobile).toContain('min-height: 0');
    expect(mobile).not.toContain('min-height: 35rem');
  });

  it('uses a compact 2-by-2 owner summary on mobile', () => {
    const css = readFileSync(join(root, 'app/global.css'), 'utf8');
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.owner-user-stats \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it('reserves mobile route-map padding for marker radius and offsets', () => {
    const source = readFileSync(
      join(root, 'components/chapters/chapter-map.tsx'),
      'utf8',
    );
    expect(source).toContain('window.innerWidth < 680 ? 92 : 96');
    expect(source).toContain('const CHAPTER_MARKER_GUTTER = 12');
  });

  it('ships route-level recovery and loading surfaces for core journeys', () => {
    const expected = [
      'app/error.tsx',
      'app/not-found.tsx',
      'app/dashboard/error.tsx',
      'app/dashboard/places/loading.tsx',
      'app/dashboard/chapters/loading.tsx',
      'app/dashboard/owner/users/loading.tsx',
      'app/shared/chapters/[shareId]/not-found.tsx',
    ];

    for (const file of expected) {
      expect(() => readFileSync(join(root, file), 'utf8')).not.toThrow();
    }
  });
});
