import {
  ArrowRightIcon,
  CheckCircleIcon,
  MapPinIcon,
  PhotoIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

const highlights = [
  {
    title: 'Place the Memory',
    copy: 'Pin where it happened',
  },
  {
    title: 'Add the whole moment',
    copy: 'Photos, date, and details',
  },
  {
    title: 'Build the Journey',
    copy: 'Connect Memories anytime',
  },
];

export function HeroSection({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">
          <SparklesIcon aria-hidden="true" />
          Memories and Journeys, mapped by you
        </p>

        <h1 id="hero-title">
          Start with a place.
          <span>Remember the whole story.</span>
        </h1>

        <p className="hero-intro">
          Place a Memory where it happened, add the photos and details that make
          it yours, then connect Memories into a Journey when the story grows.
        </p>

        <div className="hero-actions">
          <Link
            className="primary-action"
            href={
              isLoggedIn
                ? '/dashboard?new=memory'
                : '/sign-up?intent=new-memory'
            }
          >
            {isLoggedIn ? 'Place a Memory' : 'Place your first Memory'}
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <a className="secondary-action" href="#memory-creation">
            See how it works
          </a>
        </div>

        <ul className="hero-highlights" aria-label="Highlights">
          {highlights.map((highlight, index) => (
            <li key={highlight.title}>
              <span aria-hidden="true">0{index + 1}</span>
              <span>
                <strong>{highlight.title}</strong>
                <small>{highlight.copy}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="hero-art"
        role="img"
        aria-label="A placed Memory with several photos becoming part of a private Journey"
      >
        <div aria-hidden="true">
          <div className="hero-sun" />
          <div className="hero-horizon hero-horizon-back" />
          <div className="hero-horizon hero-horizon-front" />
          <div className="bridge-structure">
            <div className="bridge-rail" />
            <div className="bridge-arch" />
            <div className="bridge-deck" />
          </div>
          <div className="hero-upload-chip">
            <PhotoIcon />
            <span>
              <strong>3 photos together</strong>
              <small>One Memory · one place</small>
            </span>
          </div>
          <div className="hero-photo-stack">
            <span data-tone="river" />
            <span data-tone="lantern" />
            <span data-tone="trail" />
          </div>
          <div className="hero-field-note">
            <span className="field-note-index">Memory placed</span>
            <strong>Covered Bridge Trail</strong>
            <span className="field-note-location">
              <CheckCircleIcon />
              Photos, date, and story saved
            </span>
            <span className="hero-private-note">
              <MapPinIcon /> Private until you share
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
