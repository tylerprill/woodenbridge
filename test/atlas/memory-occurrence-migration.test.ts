import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Atlas memory occurrence migration', () => {
  const migration = readFileSync(
    join(process.cwd(), 'migrations/026_atlas_memory_occurrence_time.sql'),
    'utf8',
  );

  it('stores local wall-clock time separately from its optional UTC offset', () => {
    expect(migration).toContain('occurred_time TIME WITHOUT TIME ZONE');
    expect(migration).toContain('occurred_utc_offset_minutes SMALLINT');
    expect(migration).toContain(
      'occurred_utc_offset_minutes BETWEEN -840 AND 840',
    );
  });

  it('adds a partial owner-scoped chronology index', () => {
    expect(migration).toContain('atlas_entries_user_saved_occurrence_idx');
    expect(migration).toContain('visited_on DESC');
    expect(migration).toContain('occurred_time DESC');
    expect(migration).toContain(
      "WHERE record_state = 'saved' AND deleted_at IS NULL",
    );
  });
});
