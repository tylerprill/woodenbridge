import {
  chapterMemoryLabel,
  formatChapterDateRange,
} from '@/app/lib/chapters/format';

describe('chapter presentation formatting', () => {
  it('formats an open date range', () => {
    expect(formatChapterDateRange(null, null)).toBe('Dates open');
  });

  it('formats one dated memory without a range', () => {
    expect(formatChapterDateRange('2026-10-12', '2026-10-12')).toBe(
      'October 12, 2026',
    );
  });

  it('formats a same-year range compactly', () => {
    expect(formatChapterDateRange('2026-10-12', '2026-10-20')).toBe(
      'Oct 12 – Oct 20, 2026',
    );
  });

  it('uses singular and plural memory labels', () => {
    expect(chapterMemoryLabel(1)).toBe('1 memory');
    expect(chapterMemoryLabel(3)).toBe('3 memories');
  });
});
