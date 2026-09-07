/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';

import { FeaturedBridges } from '@/components/home/featured-bridges';
import { FieldJournal } from '@/components/home/field-journal';
import { HeroSection } from '@/components/home/hero-section';
import { HomeFooter } from '@/components/home/home-footer';
import { SiteHeader } from '@/components/home/site-header';

jest.mock('@/components/home/header-logout-button', () => ({
  HeaderLogoutButton: () => null,
}));

describe('landing page product story', () => {
  it('makes photo upload the primary guest journey', () => {
    render(
      <>
        <SiteHeader />
        <HeroSection />
        <FeaturedBridges />
        <FieldJournal />
        <HomeFooter />
      </>,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Your camera roll\. Your journey, mapped\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Start with your photos' }),
    ).toHaveAttribute('href', '/sign-up?intent=photo-import');
    expect(
      screen.getByRole('link', { name: 'See the 3-step flow' }),
    ).toHaveAttribute('href', '#photo-upload');
    expect(
      screen.getByRole('heading', {
        name: 'From camera roll to mapped journey.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('10 places recognized')).toBeInTheDocument();
    expect(
      screen.getByText('2 brought forward for review'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Upload your first journey/i }),
    ).toHaveAttribute('href', '/sign-up?intent=photo-import');
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('#photo-upload')).not.toBeNull();
    expect(document.querySelector('#how-it-works')).not.toBeNull();
    expect(document.querySelector('#privacy')).not.toBeNull();
  });

  it('sends returning members directly to photo import', () => {
    render(
      <>
        <HeroSection isLoggedIn />
        <FieldJournal isLoggedIn />
      </>,
    );

    expect(screen.getByRole('link', { name: 'Upload photos' })).toHaveAttribute(
      'href',
      '/dashboard/import',
    );
    expect(
      screen.getByRole('link', { name: /Upload another journey/i }),
    ).toHaveAttribute('href', '/dashboard/import');
  });
});
