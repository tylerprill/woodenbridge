import { AmbientBackground } from '@/components/home/ambient-background';
import { FeaturedBridges } from '@/components/home/featured-bridges';
import { FieldJournal } from '@/components/home/field-journal';
import { HeroSection } from '@/components/home/hero-section';
import { HomeFooter } from '@/components/home/home-footer';
import { SiteHeader } from '@/components/home/site-header';

export default function HomePage() {
  return (
    <div className="home-shell">
      <AmbientBackground />
      <SiteHeader />
      <main>
        <HeroSection />
        <FeaturedBridges />
        <FieldJournal />
      </main>
      <HomeFooter />
    </div>
  );
}
