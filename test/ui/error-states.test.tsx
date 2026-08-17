/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DashboardError from '@/app/dashboard/error';
import RootError from '@/app/error';
import SharedChapterUnavailable from '@/app/shared/chapters/[shareId]/not-found';

jest.mock('@/components/home/ambient-background', () => ({
  AmbientBackground: () => <div aria-hidden="true" />,
}));

describe('branded route recovery', () => {
  it('never renders exception details and provides retry recovery', async () => {
    const user = userEvent.setup();
    const reset = jest.fn();
    render(
      <RootError
        error={new Error('DATABASE_URL and internal table name')}
        reset={reset}
      />,
    );

    expect(screen.queryByText(/DATABASE_URL/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('keeps dashboard failures generic and recoverable', () => {
    render(
      <DashboardError
        error={new Error('sensitive database exception')}
        reset={jest.fn()}
      />,
    );

    expect(
      screen.queryByText(/sensitive database exception/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open atlas' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });

  it('does not reveal whether a shared chapter was revoked or never existed', () => {
    render(<SharedChapterUnavailable />);

    expect(screen.getByRole('heading')).toHaveTextContent(
      'This story is no longer on the map.',
    );
    expect(screen.getByText(/indistinguishable to protect/i)).toBeVisible();
  });
});
