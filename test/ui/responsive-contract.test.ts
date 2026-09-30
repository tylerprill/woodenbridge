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

    expect(mobile).toContain('height: 100%');
    expect(mobile).toContain('min-height: 0');
    expect(mobile).not.toContain('min-height: 35rem');
  });

  it('keeps MapLibre full-frame and sizes the compact Atlas from its viewport grid', () => {
    const atlasCss = readFileSync(
      join(root, 'components/atlas/atlas.module.css'),
      'utf8',
    );
    const globalCss = readFileSync(join(root, 'app/global.css'), 'utf8');

    expect(atlasCss).toMatch(
      /\.mapFrame > \.mapCanvas \{[\s\S]*?position: absolute;[\s\S]*?width: 100%;[\s\S]*?height: 100%;/,
    );
    expect(atlasCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.workspace \{[\s\S]*?min-height: 0;/,
    );
    expect(globalCss).toMatch(
      /@media \(max-width: 1240px\) \{[\s\S]*?\.dashboard-shell:has\(> \.dashboard-main > \.atlas-workspace-root\)[\s\S]*?height: 100dvh;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);/,
    );
    expect(globalCss).toMatch(
      /@media \(max-width: 1240px\) \{[\s\S]*?\.dashboard-main:has\(> \.atlas-workspace-root\)[\s\S]*?height: auto;[\s\S]*?min-height: 0;/,
    );
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

  it('keeps authenticated compact controls at least 44px tall', () => {
    const globalCss = readFileSync(join(root, 'app/global.css'), 'utf8');
    const atlasCss = readFileSync(
      join(root, 'components/atlas/atlas.module.css'),
      'utf8',
    );
    const chapterCss = readFileSync(
      join(root, 'components/chapters/chapters.module.css'),
      'utf8',
    );

    expect(globalCss).toMatch(
      /\.collection-sort a \{[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(atlasCss).toMatch(
      /\.filterDock button \{[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(chapterCss).toMatch(
      /\.editorHeader > div:first-child > a,[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(chapterCss).toMatch(
      /\.memoryOption > button \{[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(chapterCss).toMatch(
      /\.chapterCardRoute \{[\s\S]*?color: var\(--timber-ink\);/,
    );
  });

  it('hides Atlas memory filters in portrait and short landscape mobile layouts', () => {
    const css = readFileSync(
      join(root, 'components/atlas/atlas.module.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(max-width: 760px\) \{[\s\S]*?\.filterDock \{\s*display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-height: 480px\) and \(orientation: landscape\) \{[\s\S]*?\.workspace\[data-atlas-mode='places'\] \.filterDock \{\s*display: none;/,
    );
  });

  it('keeps Journey Segment controls compact across phone orientations', () => {
    const css = readFileSync(
      join(root, 'components/chapters/chapters.module.css'),
      'utf8',
    );
    const compact = css.match(
      /@media \(max-width: 680px\), \(max-height: 480px\) and \(orientation: landscape\) \{[\s\S]*?@media \(max-height: 480px\)/,
    )?.[0];

    expect(compact).toMatch(
      /\.journeySegmentIndex a \{[\s\S]*?min-height: 2\.75rem;[\s\S]*?border-radius: 999px;/,
    );
    expect(compact).toMatch(
      /\.journeySegmentHeading \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(compact).toMatch(
      /\.journeySegmentHeading > a \{[\s\S]*?width: 2\.75rem;[\s\S]*?height: 2\.75rem;/,
    );
  });

  it('uses a compact, consistent reading rhythm on mobile Journey details', () => {
    const css = readFileSync(
      join(root, 'components/chapters/chapters.module.css'),
      'utf8',
    );
    const mobile = css.match(
      /@media \(max-width: 680px\) \{[\s\S]*?@media \(max-width: 760px\),/,
    )?.[0];

    expect(mobile).toMatch(
      /\.chapterDetail\[data-reader-mode='owner'\] \.chapterHeroStory \{\s*padding: 1\.5rem;/,
    );
    expect(mobile).toMatch(
      /\.chapterDetail\[data-reader-mode='owner'\] \.chapterPrologue \{\s*padding-top: 3rem;/,
    );
    expect(mobile).toMatch(
      /\.chapterSectionHeading \{[\s\S]*?margin-bottom: 1\.2rem;[\s\S]*?gap: 0\.5rem;/,
    );
    expect(mobile).toMatch(
      /\.journeySegmentHeading \{[\s\S]*?margin: 1\.5rem 0 0\.9rem;[\s\S]*?padding: 0\.75rem 0\.8rem;/,
    );
    expect(mobile).toMatch(
      /\.chapterPrologue,[\s\S]*?\.chapterMemories \{\s*scroll-margin-top: 2\.75rem;/,
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
