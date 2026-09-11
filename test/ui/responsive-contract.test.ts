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

  it('keeps MapLibre full-frame and provides legacy iOS height fallbacks', () => {
    const atlasCss = readFileSync(
      join(root, 'components/atlas/atlas.module.css'),
      'utf8',
    );
    const importCss = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );

    expect(atlasCss).toMatch(
      /\.mapFrame > \.mapCanvas \{[\s\S]*?position: absolute;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
    );
    expect(atlasCss).toContain('height: calc(100vh - 5.5rem)');
    expect(atlasCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.workspace \{[\s\S]*?min-height: 0;/,
    );
    expect(importCss).toContain('height: min(29rem, 66vh)');
  });

  it('uses a compact 2-by-2 owner summary on mobile', () => {
    const css = readFileSync(join(root, 'app/global.css'), 'utf8');
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.owner-user-stats \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });

  it('keeps the landing-page hero continuous across phone and tablet seams', () => {
    const css = readFileSync(join(root, 'app/global.css'), 'utf8');
    const medium = css.match(
      /@media \(min-width: 901px\) and \(max-width: 1100px\) \{[\s\S]*?@media/,
    )?.[0];
    const tablet = css.match(
      /@media \(max-width: 900px\) \{[\s\S]*?@media/,
    )?.[0];
    const phone = css.match(
      /@media \(max-width: 520px\) \{[\s\S]*?@media/,
    )?.[0];

    expect(tablet).toMatch(/\.hero-art \{[\s\S]*?width: min\(100%, 27rem\);/);
    expect(medium).toMatch(
      /\.hero-section \{[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(css).toMatch(
      /\.bridge-grid \{[\s\S]*?repeat\([\s\S]*?auto-fit,[\s\S]*?minmax\(min\(100%, 18rem\), 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(min-width: 642px\) and \(max-width: 947px\)[\s\S]*?\.bridge-card:last-child:nth-child\(odd\)/,
    );
    expect(css).toMatch(
      /\.feature-product-preview \{[\s\S]*?aspect-ratio: 6 \/ 5;/,
    );
    expect(phone).toMatch(
      /\.hero-copy h1 \{[\s\S]*?font-size: clamp\(2\.9rem, 11\.25vw, 3\.65rem\);/,
    );
    expect(phone).toMatch(
      /\.home-footer nav \{[\s\S]*?flex-wrap: wrap;[\s\S]*?justify-content: center;/,
    );
    expect(css).toMatch(/\.site-nav a \{[\s\S]*?min-height: 2\.75rem;/);
    expect(css).toMatch(
      /\.header-action-secondary \{[\s\S]*?min-width: 2\.75rem;/,
    );
    expect(css).toMatch(
      /@media \(min-width: 521px\) and \(max-width: 1100px\)[\s\S]*?\.home-footer \{[\s\S]*?grid-template-columns: 1fr auto;[\s\S]*?\.home-footer nav \{[\s\S]*?grid-column: 1 \/ -1;/,
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

  it('uses fluid compact spacing and keeps upload actions in flow', () => {
    const css = readFileSync(
      join(root, 'components/atlas/photo-import.module.css'),
      'utf8',
    );
    const compactLayout = css.match(
      /@media \(max-width: 1120px\) \{[\s\S]*?@media/,
    )?.[0];
    const mobile = css.match(
      /@media \(max-width: 760px\) \{[\s\S]*?@media/,
    )?.[0];
    const compact = css.match(/@media \(max-width: 480px\) \{[\s\S]*\}/)?.[0];

    expect(mobile).toContain(
      '--import-mobile-card-padding: clamp(1rem, 3vw, 1.425rem)',
    );
    expect(mobile).toContain('--import-mobile-gap: clamp(1rem, 2.5vw, 1.2rem)');
    expect(mobile).toMatch(
      /\.chooseLayout,[\s\S]*?\.chapterLayout \{[\s\S]*?gap: var\(--import-mobile-gap\);/,
    );
    expect(mobile).toMatch(
      /\.dropCard,[\s\S]*?\.chapterOrder \{[\s\S]*?padding: var\(--import-mobile-card-padding\);[\s\S]*?border-radius: var\(--import-mobile-card-radius\);/,
    );
    expect(compactLayout).toMatch(
      /\.journeyMap \{[\s\S]*?height: clamp\(16rem, 43vw, 30rem\);[\s\S]*?min-height: 0;/,
    );
    expect(compactLayout).toMatch(
      /\.storyPhoto figure \{[\s\S]*?min-height: clamp\([\s\S]*?60vw[\s\S]*?\);/,
    );
    expect(compactLayout).toMatch(
      /\.actionBar \{[\s\S]*?position: static;[\s\S]*?bottom: auto;/,
    );
    expect(mobile).toMatch(
      /\.storyLayout > \.actionBar \{[\s\S]*?grid-row: 3;[\s\S]*?\.storyRail \{[\s\S]*?grid-row: 4;/,
    );
    expect(mobile).toMatch(
      /\.storyActions,[\s\S]*?\.finalActions \{[\s\S]*?flex-direction: row;[\s\S]*?align-items: center;/,
    );
    expect(mobile).toMatch(
      /\.longActionLabel \{[\s\S]*?display: none;[\s\S]*?\.shortActionLabel \{[\s\S]*?display: inline;/,
    );
    expect(mobile).toMatch(
      /\.chapterCover button \{[\s\S]*?aspect-ratio: 16 \/ 9;[\s\S]*?min-height: 0;/,
    );
    expect(compact).toMatch(
      /\.actionBar \{[\s\S]*?padding: 0\.625rem;[\s\S]*?gap: 0\.5rem;/,
    );
    expect(compact).toMatch(
      /\.storyForm \.sectionHeading \{[\s\S]*?display: flex;[\s\S]*?gap: 0\.75rem;/,
    );
    expect(compact).toMatch(
      /\.chapterLayout \.actionBar \{[\s\S]*?grid-template-columns: minmax\(0, auto\) minmax\(0, 1fr\);/,
    );
    expect(compact).toMatch(
      /\.chapterLayout \.finalActions \{[\s\S]*?flex-direction: row;[\s\S]*?gap: 0\.3rem;/,
    );
    expect(compact).toMatch(
      /\.leaveDialog > div:last-child \{[\s\S]*?justify-content: stretch;/,
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
