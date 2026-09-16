/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { getRediscoveryData } from '@/app/lib/atlas/rediscovery/data';
import * as dates from '@/app/lib/atlas/rediscovery/dates';
import type { RediscoveryData } from '@/app/lib/atlas/rediscovery/definitions';
import OnThisDayError from '@/app/dashboard/on-this-day/error';
import OnThisDayLoading from '@/app/dashboard/on-this-day/loading';
import OnThisDayPage, { metadata } from '@/app/dashboard/on-this-day/page';
import { DayControls } from '@/components/rediscovery/day-controls';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(async () => undefined),
}));

jest.mock('@/app/lib/atlas/rediscovery/data', () => ({
  getRediscoveryData: jest.fn(),
}));

jest.mock('@/app/lib/atlas/rediscovery/dates', () => ({
  ...jest.requireActual('@/app/lib/atlas/rediscovery/dates'),
  getUtcCalendarDate: jest.fn(),
  getLocalCalendarDate: jest.fn(),
}));

jest.mock('@/components/rediscovery/on-this-day', () => ({
  OnThisDay: ({
    data,
    controls,
  }: {
    data: RediscoveryData;
    controls: ReactNode;
  }) => (
    <>
      <h1>On this day</h1>
      <p data-testid="reference-date">{data.date}</p>
      {controls}
    </>
  ),
}));

const data: RediscoveryData = {
  date: '2026-09-15',
  earliestDate: '2023-09-15',
  mode: 'anniversary',
  total: 30,
  page: 2,
  pageSize: 24,
  totalPages: 2,
  memories: [],
};

describe('On this day route and date controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(dates.getUtcCalendarDate).mockReturnValue('2026-09-16');
    jest.mocked(dates.getLocalCalendarDate).mockReturnValue('2026-09-15');
    jest.mocked(getRediscoveryData).mockResolvedValue(data);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('loads a validated date and page behind verified authentication', async () => {
    const view = await OnThisDayPage({
      searchParams: Promise.resolve({ date: '2026-09-15', page: '2' }),
    });
    const { container } = render(view);

    expect(requireVerifiedSession).toHaveBeenCalledTimes(1);
    expect(getRediscoveryData).toHaveBeenCalledWith({
      date: '2026-09-15',
      page: 2,
    });
    expect(container.firstElementChild).toHaveAttribute(
      'data-rediscovery-state',
      'ready',
    );
    expect(container.firstElementChild).toHaveAttribute(
      'data-rediscovery-mode',
      'anniversary',
    );
    expect(screen.getByTestId('reference-date')).toHaveTextContent(
      '2026-09-15',
    );
    expect(screen.getByLabelText('Choose a date')).toHaveValue('2026-09-15');
    expect(screen.getByLabelText('Choose a date')).toHaveAttribute(
      'min',
      '2023-09-15',
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('resolves browser-local today before fetching memories, not server UTC today', async () => {
    render(await OnThisDayPage({ searchParams: Promise.resolve({}) }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/dashboard/on-this-day?date=2026-09-15',
      ),
    );
    expect(getRediscoveryData).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('local time');
    expect(
      screen.getByRole('heading', { name: 'On this day' }),
    ).toBeInTheDocument();
  });

  it.each([
    '2026-02-31',
    '2030-09-15',
    'not-a-date',
    ['2026-09-15', '2026-09-14'],
  ])(
    'recovers malformed, duplicated or arbitrary future dates without querying them: %s',
    async (date) => {
      render(await OnThisDayPage({ searchParams: Promise.resolve({ date }) }));

      await waitFor(() =>
        expect(mockReplace).toHaveBeenCalledWith(
          '/dashboard/on-this-day?date=2026-09-15',
        ),
      );
      expect(getRediscoveryData).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent(
        'That date is not available',
      );
    },
  );

  it('allows the local day ahead of UTC for eastern time zones', async () => {
    await OnThisDayPage({
      searchParams: Promise.resolve({ date: '2026-09-17' }),
    });
    expect(getRediscoveryData).toHaveBeenCalledWith({
      date: '2026-09-17',
      page: 1,
    });
  });

  it('recovers to an accepted date when the device clock is far ahead', async () => {
    jest.mocked(dates.getLocalCalendarDate).mockReturnValue('2030-09-15');
    render(await OnThisDayPage({ searchParams: Promise.resolve({}) }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/dashboard/on-this-day?date=2026-09-16',
      ),
    );
    expect(getRediscoveryData).not.toHaveBeenCalled();
  });

  it('resolves the eastern local day without replacing it with UTC', async () => {
    jest.mocked(dates.getLocalCalendarDate).mockReturnValue('2026-09-17');
    render(await OnThisDayPage({ searchParams: Promise.resolve({}) }));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        '/dashboard/on-this-day?date=2026-09-17',
      ),
    );
  });

  it.each(['2oops', 'Infinity', '999999999999999999999', ['2', '3']])(
    'normalizes unsafe page values: %s',
    async (page) => {
      await OnThisDayPage({
        searchParams: Promise.resolve({ date: '2026-09-15', page }),
      });
      expect(getRediscoveryData).toHaveBeenCalledWith({
        date: '2026-09-15',
        page: 1,
      });
    },
  );

  it('does not fetch private memories when verification fails', async () => {
    jest
      .mocked(requireVerifiedSession)
      .mockRejectedValueOnce(new Error('Unverified'));

    await expect(
      OnThisDayPage({ searchParams: Promise.resolve({ date: '2026-09-15' }) }),
    ).rejects.toThrow('Unverified');
    expect(getRediscoveryData).not.toHaveBeenCalled();
  });

  it('uses a native GET date form, disables future navigation and computes Today freshly', async () => {
    const user = userEvent.setup();
    render(<DayControls date="2026-09-15" />);
    const input = screen.getByLabelText('Choose a date');
    const form = input.closest('form');

    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/dashboard/on-this-day');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).toHaveAttribute('name', 'date');
    expect(input).toHaveAttribute('max', '2026-09-15');
    expect(input).not.toHaveAttribute('min');
    expect(screen.getByRole('link', { name: 'Previous day' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-14',
    );
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    jest.mocked(dates.getLocalCalendarDate).mockReturnValue('2026-09-16');
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(mockPush).toHaveBeenCalledWith(
      '/dashboard/on-this-day?date=2026-09-16',
    );
  });

  it('keeps the date picker usable when the account only has future-dated memories', async () => {
    jest.mocked(getRediscoveryData).mockResolvedValue({
      ...data,
      mode: 'recent',
      total: 0,
      earliestDate: '2027-01-01',
      memories: [],
    });

    render(
      await OnThisDayPage({
        searchParams: Promise.resolve({ date: '2026-09-15' }),
      }),
    );

    const input = screen.getByLabelText('Choose a date');
    expect(input).not.toHaveAttribute('min');
    expect(input).toHaveAttribute('max', '2026-09-15');
  });

  it('handles year boundaries and resets the field after date navigation', () => {
    const { rerender } = render(<DayControls date="2026-01-01" />);
    expect(screen.getByRole('link', { name: 'Previous day' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2025-12-31',
    );
    expect(screen.getByRole('link', { name: 'Next day' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-01-02',
    );

    rerender(<DayControls date="2025-12-31" />);
    expect(screen.getByLabelText('Choose a date')).toHaveValue('2025-12-31');
  });

  it('disables previous-day navigation at the account memory boundary', () => {
    render(<DayControls date="1899-09-15" minDate="1899-09-15" />);

    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    expect(
      screen.queryByRole('link', { name: 'Previous day' }),
    ).not.toBeInTheDocument();
  });

  it('refreshes Next day and the input maximum at local midnight', () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 15, 23, 59, 59) });
    render(<DayControls date="2026-09-15" />);
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled();

    jest.mocked(dates.getLocalCalendarDate).mockReturnValue('2026-09-16');
    act(() => jest.advanceTimersByTime(1500));

    expect(screen.getByRole('link', { name: 'Next day' })).toHaveAttribute(
      'href',
      '/dashboard/on-this-day?date=2026-09-16',
    );
    expect(screen.getByLabelText('Choose a date')).toHaveAttribute(
      'max',
      '2026-09-16',
    );
  });

  it('provides private metadata and distinct loading/error recovery', async () => {
    expect(metadata.title).toBe('On this day — Field Atlas');
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const { unmount } = render(<OnThisDayLoading />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Bringing your memories',
    );
    unmount();

    const reset = jest.fn();
    const user = userEvent.setup();
    render(<OnThisDayError reset={reset} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was changed');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Open atlas' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});
