import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Atlas journey migration', () => {
  const migration = readFileSync(
    join(process.cwd(), 'migrations/025_atlas_journeys.sql'),
    'utf8',
  );

  it('adds scoped Chapter idempotency without introducing a second Journey entity', () => {
    expect(migration).toContain('client_request_id UUID');
    expect(migration).toContain(
      'ON atlas_chapters (user_id, client_request_id)',
    );
    expect(migration).not.toMatch(
      /CREATE TABLE IF NOT EXISTS atlas_journeys\b/,
    );
  });

  it('scopes durable suggestion feedback to its owner', () => {
    expect(migration).toContain('PRIMARY KEY (user_id, suggestion_key)');
    expect(migration).toContain('FOREIGN KEY (chapter_id, user_id)');
    expect(migration).toContain("decision IN ('dismissed', 'accepted')");
  });
});
