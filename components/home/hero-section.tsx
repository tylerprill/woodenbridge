import {
  ArrowRightIcon,
  MapPinIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const highlights = [
  'Historic spans',
  'Trail-ready guides',
  'Personal collections',
];

export function HeroSection() {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">
          <SparklesIcon aria-hidden="true" />
          An atlas for the curious
        </p>

        <h1 id="hero-title">
          Built by hand.
          <span>Found by wonder.</span>
        </h1>

        <p className="hero-intro">
          Discover remarkable wooden bridges, the landscapes they cross, and the
          stories held in every timber.
        </p>

        <div className="hero-actions">
          <a className="primary-action" href="#featured">
            Explore the atlas
            <ArrowRightIcon aria-hidden="true" />
          </a>
          <Link className="secondary-action" href="/sign-up">
            Start a collection
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
        aria-label="A stylized wooden bridge landscape"
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
          <strong>Crossings worth the journey</strong>
          <span className="field-note-location">
            <MapPinIcon aria-hidden="true" />
            Wander slowly. Look closely.
          </span>
        </div>
      </div>
    </section>
  );
}
