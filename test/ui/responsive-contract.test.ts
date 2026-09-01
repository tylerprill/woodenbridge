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

  it('keeps the photo-import surface within a 320px viewport', () => {
    const css = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );
    const compactPage = css.match(
      /@media \(max-width: 480px\) \{[\s\S]*?\.page \{([\s\S]*?)\n  \}/,
    )?.[1];

    expect(compactPage).toContain('width: 100%');
    expect(compactPage).toContain('margin-inline: auto');
    expect(compactPage).not.toMatch(/calc\(100%\s*\+/);
    expect(compactPage).not.toMatch(/margin-inline:\s*-/);
  });

  it('uses one compact spacing rhythm across the mobile upload flow', () => {
    const css = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );
    const mobile = css.match(
      /@media \(max-width: 760px\) \{[\s\S]*?@media/,
    )?.[0];
    const compact = css.match(/@media \(max-width: 480px\) \{[\s\S]*\}/)?.[0];

    expect(mobile).toContain('--import-mobile-gap: 1rem');
    expect(mobile).toMatch(
      /\.chooseLayout,[\s\S]*?\.chapterLayout \{[\s\S]*?gap: var\(--import-mobile-gap\);/,
    );
    expect(compact).toMatch(
      /\.dropCard,[\s\S]*?\.chapterOrder \{[\s\S]*?padding: 1rem;/,
    );
    expect(compact).toMatch(
      /\.actionBar \{[\s\S]*?padding: 0\.625rem;[\s\S]*?gap: 0\.5rem;/,
    );
    expect(compact).toMatch(
      /\.storyForm \.sectionHeading \{[\s\S]*?display: flex;[\s\S]*?gap: 0\.75rem;/,
    );
    expect(compact).toMatch(
      /\.longActionLabel \{[\s\S]*?display: none;[\s\S]*?\.shortActionLabel \{[\s\S]*?display: inline;/,
    );
  });

  it('keeps optional-detail actions in one compact phone row', () => {
    const css = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );
    const compact = css.match(/@media \(max-width: 480px\) \{[\s\S]*\}/)?.[0];

    expect(compact).toMatch(
      /\.storyActions \{[\s\S]*?flex-direction: row;[\s\S]*?align-items: center;/,
    );
    expect(compact).toMatch(
      /\.storyActions > button \{[\s\S]*?min-width: 0;[\s\S]*?flex: 1 1 0;/,
    );
  });

  it('keeps the keyboard map-center action at least 44px tall', () => {
    const css = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );
    const centerAction = css.match(
      /\.locationControls button \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(centerAction).toContain('min-height: 2.75rem');
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
