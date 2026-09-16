'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  formatCalendarDate,
  getLocalCalendarDate,
  onThisDayHref,
  shiftCalendarDate,
} from '@/app/lib/atlas/rediscovery/dates';
import styles from './day-controls.module.css';

export function LocalDay({
  fallbackDate,
  invalidDate = false,
}: {
  fallbackDate: string;
  invalidDate?: boolean;
}) {
  const router = useRouter();
  const resolving = useRef(false);

  useEffect(() => {
    if (resolving.current) return;
    resolving.current = true;
    const localDate = getLocalCalendarDate();
    const latestDate = shiftCalendarDate(fallbackDate, 1) ?? fallbackDate;
    // A badly skewed device clock must not send recovery to another date the
    // server rejects. Normal local dates ahead of UTC are still respected.
    router.replace(
      onThisDayHref(localDate <= latestDate ? localDate : fallbackDate),
    );
  }, [fallbackDate, router]);

  return (
    <div className={styles.status} role="status">
      <p>
        {invalidDate
          ? 'That date is not available. Returning to today’s memories…'
          : 'Finding today’s memories in your local time…'}
      </p>
      <noscript>
        <p>
          Choose a date above, or{' '}
          <Link href={onThisDayHref(fallbackDate)}>
            view {formatCalendarDate(fallbackDate)} (UTC)
          </Link>
          . Your memories stay private.
        </p>
      </noscript>
    </div>
  );
}
