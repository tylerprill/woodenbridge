// write a test suite for the sidenav component
import React from 'react';
import { render, screen, userEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import SideNav from './sidenav';
import { signOut } from '@/auth';

// Mock the dependencies
jest.mock('next/link', () => ({ children }: any) => <div>{children}</div>);
jest.mock('@/components/dashboard/nav-links', () => () => <div>NavLinks</div>);
jest.mock('@heroicons/react/24/outline', () => ({
  PowerIcon: () => <svg data-testid="power-icon" />,
}));
jest.mock('@/auth', () => ({
  signOut: jest.fn(),
}));

describe('SideNav', () => {
  it('renders the SideNav component', () => {
    render(<SideNav />);
    expect(screen.getByText('test'));
    expect(screen.getByText('NavLinks'));
    expect(screen.getByText('Sign Out'));
  });

  it('renders the Link component', () => {
    render(<SideNav />);
    const linkElement = screen.getByText('test');
    expect(linkElement.closest('a')).toHaveAttribute('href', '/');
  });

  it('renders the NavLinks component', () => {
    render(<SideNav />);
    expect(screen.getByText('NavLinks')).toBeInTheDocument();
  });

  it('renders the Sign Out button and calls signOut on click', async () => {
    render(<SideNav />);
    const signOutButton = screen.getByText('Sign Out');
    expect(signOutButton).toBeInTheDocument();

    userEvent.click(signOutButton);
    expect(signOut).toHaveBeenCalled();
  });

  it('renders the PowerIcon', () => {
    render(<SideNav />);
    expect(screen.getByTestId('power-icon')).toBeInTheDocument();
  });
});
