/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes } from 'react';

import { logOut } from '@/app/lib/actions/auth';
import SideNav from '@/components/unclean/dashboard/sidenav';

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, ...anchorProps }: MockLinkProps) => (
    <a {...anchorProps} href={href} />
  ),
}));

jest.mock('@/app/lib/actions/auth', () => ({
  logOut: jest.fn(),
}));

jest.mock('@/components/clean/brand-lockup', () => ({
  BrandLockup: () => <span>Field Atlas</span>,
}));

jest.mock('@/components/unclean/dashboard/nav-links', () => ({
  __esModule: true,
  default: () => <span>Primary navigation</span>,
}));

const logOutMock = jest.mocked(logOut);

function getCompactAccountMenu() {
  const accountLabel = screen.getByText('Account');
  const menu = accountLabel.closest('details');

  if (!menu) throw new Error('Compact account menu was not rendered.');
  return menu;
}

describe('dashboard account navigation', () => {
  it('provides a labeled account destination and sign-out action on compact layouts', async () => {
    const user = userEvent.setup();
    render(
      <SideNav
        role="user"
        userEmail="ada@example.com"
        userName="Ada Lovelace"
      />,
    );
    const menu = getCompactAccountMenu();

    expect(
      screen.getByRole('link', {
        name: 'Open account security for Ada Lovelace',
      }),
    ).toHaveAttribute('href', '/dashboard/security');
    expect(
      within(menu).getByRole('link', { name: /account & security/i }),
    ).toHaveAttribute('href', '/dashboard/security');

    await user.click(within(menu).getByText('Account'));

    expect(menu).toHaveAttribute('open');
    expect(within(menu).getByText('ada@example.com')).toBeVisible();
    expect(within(menu).queryByRole('link', { name: /^users/i })).toBeNull();

    await user.click(
      within(menu).getByRole('link', { name: /account & security/i }),
    );
    expect(menu).not.toHaveAttribute('open');

    await user.click(within(menu).getByText('Account'));

    await user.click(within(menu).getByRole('button', { name: /^sign out/i }));

    expect(logOutMock).toHaveBeenCalledWith({ redirectTo: '/' });
  });

  it.each(['admin', 'owner'] as const)(
    'keeps protected user management in the %s account menu',
    (role) => {
      render(
        <SideNav
          role={role}
          userEmail="admin@example.com"
          userName="Atlas Admin"
        />,
      );

      expect(
        within(getCompactAccountMenu()).getByRole('link', { name: /^users/i }),
      ).toHaveAttribute('href', '/dashboard/owner/users');
    },
  );
});
