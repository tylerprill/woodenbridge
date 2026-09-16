import type { Metadata } from 'next';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getRediscoveryData } from '@/app/lib/atlas/rediscovery/data';
import {
  getUtcCalendarDate,
  parseCalendarDate,
  shiftCalendarDate,
} from '@/app/lib/atlas/rediscovery/dates';
import { DayControls } from '@/components/rediscovery/day-controls';
import { DayShell } from '@/components/rediscovery/day-shell';
import { LocalDay } from '@/components/rediscovery/local-day';
import { OnThisDay } from '@/components/rediscovery/on-this-day';

export const metadata: Metadata = {
  title: 'On this day — Field Atlas',
  description:
    'Return to your private memories from this date in earlier years.',
  robots: { index: false, follow: false },
};

export default async function OnThisDayPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string | string[];
    page?: string | string[];
  }>;
}) {
  const [query] = await Promise.all([searchParams, requireVerifiedSession()]);
  const fallbackDate = getUtcCalendarDate();
  // Local calendar days can be a day ahead of UTC. Allow that boundary without
  // accepting arbitrary future years as pretend anniversaries.
  const latestDate = shiftCalendarDate(fallbackDate, 1) ?? fallbackDate;
  const selectedDate = parseCalendarDate(query.date);

  if (!selectedDate || selectedDate > latestDate) {
    return (
      <DayShell>
        <DayControls date={fallbackDate} />
        <LocalDay
          fallbackDate={fallbackDate}
          invalidDate={query.date !== undefined}
        />
      </DayShell>
    );
  }

  const requestedPage =
    typeof query.page === 'string' && /^\d+$/.test(query.page)
      ? Number(query.page)
      : 1;
  const data = await getRediscoveryData({
    date: selectedDate,
    page: Number.isSafeInteger(requestedPage) ? requestedPage : 1,
  });

  return (
    <div data-rediscovery-state="ready" data-rediscovery-mode={data.mode}>
      <OnThisDay data={data} controls={<DayControls date={data.date} />} />
    </div>
  );
}
