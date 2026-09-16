'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import {
  getLocalCalendarDate,
  onThisDayHref,
  shiftCalendarDate,
} from '@/app/lib/atlas/rediscovery/dates';
import styles from './day-controls.module.css';

function subscribeToLocalDay(onChange: () => void) {
  let midnightTimer: ReturnType<typeof setTimeout>;
  const scheduleMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 250);
    midnightTimer = setTimeout(() => {
      onChange();
      scheduleMidnight();
    }, midnight.getTime() - now.getTime());
  };
  scheduleMidnight();
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearTimeout(midnightTimer);
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

const serverDay = () => null;

export function DayControls({ date }: { date: string }) {
  const router = useRouter();
  const today = useSyncExternalStore(
    subscribeToLocalDay,
    getLocalCalendarDate,
    serverDay,
  );
  const previous = shiftCalendarDate(date, -1);
  const next = shiftCalendarDate(date, 1);
  const canAdvance = next !== null && today !== null && next <= today;

  return (
    <div className={styles.controls}>
      <nav className={styles.browse} aria-label="Browse memory dates">
        {previous ? (
          <Link href={onThisDayHref(previous)} aria-label="Previous day">
            <ChevronLeftIcon aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" aria-label="Previous day" disabled>
            <ChevronLeftIcon aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          onClick={() => router.push(onThisDayHref(getLocalCalendarDate()))}
        >
          Today
        </button>
        {canAdvance ? (
          <Link href={onThisDayHref(next)} aria-label="Next day">
            <ChevronRightIcon aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" aria-label="Next day" disabled>
            <ChevronRightIcon aria-hidden="true" />
          </button>
        )}
      </nav>
      <form
        action="/dashboard/on-this-day"
        method="get"
        className={styles.form}
      >
        <label htmlFor="memory-day">Choose a date</label>
        <div className={styles.fields}>
          <input
            key={date}
            id="memory-day"
            name="date"
            type="date"
            defaultValue={date}
            max={today ?? undefined}
            min="0001-01-01"
            required
          />
          <button type="submit">Find memories</button>
        </div>
      </form>
    </div>
  );
}
