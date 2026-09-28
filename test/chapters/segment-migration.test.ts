import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Journey segment migration', () => {
  const migration = readFileSync(
    join(process.cwd(), 'migrations/027_atlas_journey_segments.sql'),
    'utf8',
  );

  it('adds owner-scoped ordered segments without rewriting existing Journeys', () => {
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS atlas_chapter_segments',
    );
    expect(migration).toContain('FOREIGN KEY (chapter_id, user_id)');
    expect(migration).toContain('REFERENCES atlas_chapters(id, user_id)');
    expect(migration).toContain('UNIQUE (chapter_id, position)');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS segment_id UUID');
    expect(migration).not.toMatch(
      /UPDATE\s+atlas_chapter_entries\s+SET\s+segment_id/i,
    );
  });

  it('prevents a Memory from referencing another owner or Journey segment', () => {
    expect(migration).toContain(
      'FOREIGN KEY (segment_id, chapter_id, user_id)',
    );
    expect(migration).toContain(
      'REFERENCES atlas_chapter_segments(id, chapter_id, user_id)',
    );
    expect(migration).toContain('ON DELETE SET NULL (segment_id)');
  });
});
