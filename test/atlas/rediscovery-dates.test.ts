import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ModuleKind, transpileModule } from 'typescript';

import {
  formatCalendarDate,
  getLocalCalendarDate,
  getUtcCalendarDate,
  onThisDayHref,
  parseCalendarDate,
  shiftCalendarDate,
} from '@/app/lib/atlas/rediscovery/dates';

describe('rediscovery calendar dates', () => {
  it.each([
    '0001-01-01',
    '0099-12-31',
    '1900-02-28',
    '2000-02-29',
    '2024-02-29',
    '2026-09-15',
    '9999-12-31',
  ])('accepts the real ISO calendar date %s', (date) => {
    expect(parseCalendarDate(date)).toBe(date);
  });

  it.each([
    undefined,
    null,
    20260915,
    ['2026-09-15'],
    '',
    ' 2026-09-15',
    '2026-09-15 ',
    '2026-09-15\n',
    '2026-9-15',
    '2026-09-5',
    '2026-09-15T00:00:00.000Z',
    '0000-01-01',
    '10000-01-01',
    '2026-00-15',
    '2026-13-15',
    '2026-09-00',
    '2026-09-31',
    '2026-04-31',
    '2026-02-31',
    '2026-02-29',
    '1900-02-29',
    '2100-02-29',
  ])('rejects invalid or non-canonical input %p', (input) => {
    expect(parseCalendarDate(input)).toBeNull();
  });

  it.each([
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-02-28', 1, '2026-03-01'],
    ['1900-02-28', 1, '1900-03-01'],
    ['2000-02-28', 1, '2000-02-29'],
    ['0099-12-31', 1, '0100-01-01'],
    ['0001-01-01', 0, '0001-01-01'],
    ['9999-12-31', 0, '9999-12-31'],
    ['2026-09-15', 7, '2026-09-22'],
  ])('shifts %s by %s calendar days', (date, delta, expected) => {
    expect(shiftCalendarDate(date, delta)).toBe(expected);
  });

  it.each([
    ['0001-01-01', -1],
    ['9999-12-31', 1],
    ['2026-02-31', 1],
    ['2026-09-15', 0.5],
    ['2026-09-15', Number.NaN],
    ['2026-09-15', Number.POSITIVE_INFINITY],
    ['2026-09-15', Number.MAX_SAFE_INTEGER],
  ])(
    'returns no adjacent date for invalid or overflowing %s + %s',
    (date, delta) => {
      expect(shiftCalendarDate(date, delta)).toBeNull();
    },
  );

  it('formats pure dates in UTC even when a different display timezone is requested', () => {
    expect(formatCalendarDate('2026-09-15')).toBe('September 15, 2026');
    expect(
      formatCalendarDate('2026-09-15', {
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
      }),
    ).toBe('September 15');
    expect(formatCalendarDate('2024-02-29')).toBe('February 29, 2024');
    expect(formatCalendarDate('0099-12-31')).toBe('December 31, 99');
  });

  it('rejects invalid Date objects and invalid formatting dates', () => {
    expect(() => getLocalCalendarDate(new Date(Number.NaN))).toThrow(
      RangeError,
    );
    expect(() => getUtcCalendarDate(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => formatCalendarDate('2026-02-31')).toThrow(RangeError);
    expect(() => onThisDayHref('2026-02-31')).toThrow(RangeError);
  });

  it('uses the supplied local and UTC clock parts and defaults to the current clock', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00.000Z'));
    try {
      expect(getUtcCalendarDate()).toBe('2026-09-15');
      expect(getLocalCalendarDate()).toBe(getLocalCalendarDate(new Date()));
      expect(getLocalCalendarDate(new Date(2026, 8, 14, 23, 30))).toBe(
        '2026-09-14',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('links dates and clamps invalid page values without losing the selected date', () => {
    expect(onThisDayHref('2026-09-15')).toBe(
      '/dashboard/on-this-day?date=2026-09-15',
    );
    expect(onThisDayHref('2026-09-15', 3.8)).toBe(
      '/dashboard/on-this-day?date=2026-09-15&page=3',
    );
    for (const page of [0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(onThisDayHref('2026-09-15', page)).toBe(
        '/dashboard/on-this-day?date=2026-09-15',
      );
    }
  });
});

describe('real browser-local calendar boundaries', () => {
  const dateHelperSource = transpileModule(
    readFileSync(
      path.join(process.cwd(), 'app/lib/atlas/rediscovery/dates.ts'),
      'utf8',
    ),
    { compilerOptions: { module: ModuleKind.CommonJS } },
  ).outputText;

  it.each([
    ['America/Detroit', '2026-09-15T03:30:00.000Z', '2026-09-14', '2026-09-15'],
    [
      'Pacific/Honolulu',
      '2026-09-15T05:30:00.000Z',
      '2026-09-14',
      '2026-09-15',
    ],
    [
      'Pacific/Kiritimati',
      '2026-09-15T12:30:00.000Z',
      '2026-09-16',
      '2026-09-15',
    ],
    ['America/Detroit', '2026-03-08T06:30:00.000Z', '2026-03-08', '2026-03-08'],
    ['America/Detroit', '2026-11-01T05:30:00.000Z', '2026-11-01', '2026-11-01'],
  ])(
    'respects %s at %s without drifting shifted/display dates',
    (timezone, instant, local, utc) => {
      const script = `
      const helpers = {};
      ((exports) => { ${dateHelperSource} })(helpers);
      const now = new Date(${JSON.stringify(instant)});
      process.stdout.write(JSON.stringify({
        local: helpers.getLocalCalendarDate(now),
        utc: helpers.getUtcCalendarDate(now),
        next: helpers.shiftCalendarDate('2026-03-08', 1),
        label: helpers.formatCalendarDate('2026-09-15')
      }));
    `;
      const result = JSON.parse(
        execFileSync(process.execPath, ['--eval', script], {
          env: { ...process.env, TZ: timezone },
          encoding: 'utf8',
          timeout: 10_000,
        }),
      );
      expect(result).toEqual({
        local,
        utc,
        next: '2026-03-09',
        label: 'September 15, 2026',
      });
    },
  );
});
