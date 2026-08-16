import {
  ArrowRightIcon,
  MapPinIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const highlights = [
  'Your personal map',
  'Photo memories',
  'Private by default',
];

export function HeroSection() {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">
          <SparklesIcon aria-hidden="true" />
          Your personal travel journal
        </p>

        <h1 id="hero-title">
          Every place.
          <span>A story worth keeping.</span>
        </h1>

        <p className="hero-intro">
          Pin the places you have traveled, add the moments that made them
          matter, and build a map that is unmistakably yours.
        </p>

        <div className="hero-actions">
          <a className="primary-action" href="#featured">
            Explore the atlas
            <ArrowRightIcon aria-hidden="true" />
          </a>
          <Link className="secondary-action" href="/sign-up">
            Start your atlas
          </Link>
        </div>

        <ul className="hero-highlights" aria-label="Highlights">
          {highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </div>

      <div
        className="hero-art"
        role="img"
        aria-label="A stylized mapped travel landscape"
      >
        <div className="hero-sun" />
        <div className="hero-horizon hero-horizon-back" />
        <div className="hero-horizon hero-horizon-front" />
        <div className="bridge-structure" aria-hidden="true">
          <div className="bridge-rail" />
          <div className="bridge-arch" />
          <div className="bridge-deck" />
        </div>
        <div className="hero-field-note">
          <span className="field-note-index">Field note 01</span>
          <strong>Somewhere worth remembering</strong>
          <span className="field-note-location">
            <MapPinIcon aria-hidden="true" />
            Pin the places that shaped you.
          </span>
        </div>
      </div>
    </section>
  );
}
