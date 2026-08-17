/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react';
import { usePathname } from 'next/navigation';

import type { AppRole } from '@/app/lib/auth/roles';
import NavLinks from '@/components/unclean/dashboard/nav-links';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

const usePathnameMock = jest.mocked(usePathname);

function renderNavigation(role: AppRole, pathname = '/dashboard') {
  usePathnameMock.mockReturnValue(pathname);
  render(<NavLinks role={role} />);
}

function getNavigationGroups() {
  return {
    account: screen.getByRole('group', { name: 'Account' }),
    atlas: screen.getByRole('group', { name: 'Your atlas' }),
  };
}

describe('dashboard navigation', () => {
  it('separates atlas links from the account links available to every user', () => {
    renderNavigation('user');
    const { account, atlas } = getNavigationGroups();

    expect(within(atlas).getByRole('link', { name: 'Atlas' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(
      within(atlas).getByRole('link', { name: 'My places' }),
    ).toHaveAttribute('href', '/dashboard/places');
    expect(
      within(atlas).getByRole('link', { name: 'My Chapters' }),
    ).toHaveAttribute('href', '/dashboard/chapters');
    expect(
      within(account).getByRole('link', { name: 'Security' }),
    ).toHaveAttribute('href', '/dashboard/security');
    expect(
      screen.queryByRole('link', { name: 'Users' }),
    ).not.toBeInTheDocument();
  });

  it.each(['admin', 'owner'] as const)(
    'shows the Users account link to the %s role',
    (role) => {
      renderNavigation(role);
      const { account } = getNavigationGroups();

      expect(
        within(account).getByRole('link', { name: 'Security' }),
      ).toBeInTheDocument();
      expect(
        within(account).getByRole('link', { name: 'Users' }),
      ).toHaveAttribute('href', '/dashboard/owner/users');
    },
  );

  it.each([
    {
      linkName: 'Security',
      pathname: '/dashboard/security/passkeys',
    },
    {
      linkName: 'Users',
      pathname: '/dashboard/owner/users/1e11d64f-0f5e-42c3-a935-b260764bfa7a',
    },
  ])('keeps $linkName active on nested routes', ({ linkName, pathname }) => {
    renderNavigation('owner', pathname);

    const activeLink = screen.getByRole('link', { name: linkName });

    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink).toHaveClass('dashboard-nav-link-active');
    expect(screen.getByRole('link', { name: 'Atlas' })).not.toHaveClass(
      'dashboard-nav-link-active',
    );
  });
});
