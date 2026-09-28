/**
 * @jest-environment jsdom
 */

import { render, screen, within } from '@testing-library/react';
import type { LinkProps } from 'next/link';
import { usePathname } from 'next/navigation';
import type { AnchorHTMLAttributes } from 'react';

import type { AppRole } from '@/app/lib/auth/roles';
import NavLinks from '@/components/unclean/dashboard/nav-links';

type MockLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: LinkProps['prefetch'];
};

const mockLinkPrefetchProps = jest.fn<
  void,
  [Pick<MockLinkProps, 'href' | 'prefetch'>]
>();

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, prefetch, ...anchorProps }: MockLinkProps) => {
    mockLinkPrefetchProps({ href, prefetch });
    return <a {...anchorProps} href={href} />;
  },
}));

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

const usePathnameMock = jest.mocked(usePathname);

function renderNavigation(role: AppRole, pathname = '/dashboard') {
  usePathnameMock.mockReturnValue(pathname);
  render(<NavLinks role={role} />);
}

function getPrivilegedNavigationGroups() {
  return {
    account: screen.getByRole('group', { name: 'Account' }),
    atlas: screen.getByRole('group', { name: 'Your atlas' }),
  };
}

describe('dashboard navigation', () => {
  beforeEach(() => {
    mockLinkPrefetchProps.mockClear();
  });

  it('disables prefetch for the heavier Journey route', () => {
    renderNavigation('owner', '/dashboard/chapters');

    expect(mockLinkPrefetchProps.mock.calls.map(([props]) => props)).toEqual([
      { href: '/dashboard', prefetch: undefined },
      { href: '/dashboard/places', prefetch: undefined },
      { href: '/dashboard/chapters', prefetch: false },
      { href: '/dashboard/security', prefetch: undefined },
      { href: '/dashboard/owner/users', prefetch: undefined },
    ]);
  });

  it('shows only atlas navigation to a standard user', () => {
    renderNavigation('user');
    const atlas = screen.getByRole('group', { name: 'Your atlas' });

    expect(within(atlas).getByRole('link', { name: 'Atlas' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(
      within(atlas).getByRole('link', { name: 'Memories' }),
    ).toHaveAttribute('href', '/dashboard/places');
    expect(
      within(atlas).getByRole('link', { name: 'Journeys' }),
    ).toHaveAttribute('href', '/dashboard/chapters');
    expect(
      within(atlas).queryByRole('link', { name: 'Adventures' }),
    ).not.toBeInTheDocument();
    expect(
      within(atlas).queryByRole('link', { name: /chapters/i }),
    ).not.toBeInTheDocument();
    expect(
      within(atlas).queryByRole('link', { name: 'Upload photos' }),
    ).not.toBeInTheDocument();
    expect(
      within(atlas).queryByRole('link', { name: 'On this day' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Account' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Security' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Users' }),
    ).not.toBeInTheDocument();
  });

  it.each(['admin', 'owner'] as const)(
    'shows the Users account link to the %s role',
    (role) => {
      renderNavigation(role);
      const { account } = getPrivilegedNavigationGroups();

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
      linkName: 'Memories',
      pathname: '/dashboard/places',
    },
    {
      linkName: 'Journeys',
      pathname: '/dashboard/chapters/6a67afcf-768f-4fe4-8c62-41b58a19840d/edit',
    },
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
