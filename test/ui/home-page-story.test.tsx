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
  it('makes Memory creation the primary guest journey', () => {
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
        name: /Start with a place\. Remember the whole story\./i,
      }),
    ).toBeInTheDocument();
    const memoryLinks = screen.getAllByRole('link', {
      name: 'Place your first Memory',
    });
    expect(memoryLinks).toHaveLength(2);
    expect(memoryLinks[0]).toHaveAttribute(
      'href',
      '/sign-up?intent=new-memory',
    );
    expect(
      screen.getByRole('link', { name: /Create account/i }),
    ).toHaveAttribute('href', '/sign-up?intent=new-memory');
    expect(
      screen.getByRole('link', { name: 'See how it works' }),
    ).toHaveAttribute('href', '#memory-creation');
    expect(
      screen.getByRole('heading', {
        name: 'From one place to a mapped Journey.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Saved to your atlas')).toBeInTheDocument();
    expect(screen.getByText('1 private journey')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Connect Memories into a Journey.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Your next Memory starts with a place.',
      }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\bchapters?\b/i);
    expect(screen.getByText('Reorder and edit anytime')).toBeInTheDocument();
    expect(memoryLinks[1]).toHaveAttribute(
      'href',
      '/sign-up?intent=new-memory',
    );
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('#memory-creation')).not.toBeNull();
    expect(document.querySelector('#how-it-works')).not.toBeNull();
    expect(document.querySelector('#privacy')).not.toBeNull();
  });

  it('sends returning members directly to Memory creation', () => {
    render(
      <>
        <HeroSection isLoggedIn />
        <FieldJournal isLoggedIn />
      </>,
    );

    expect(
      screen.getByRole('link', { name: 'Place a Memory' }),
    ).toHaveAttribute('href', '/dashboard?new=memory');
    expect(
      screen.getByRole('link', { name: /Place another Memory/i }),
    ).toHaveAttribute('href', '/dashboard?new=memory');
  });
});
