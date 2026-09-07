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
    title: 'Upload together',
    copy: 'Bring in the whole trip',
  },
  {
    title: 'Places recognized',
    copy: 'Review only exceptions',
  },
  {
    title: 'Private by default',
    copy: 'Share when you choose',
  },
];

export function HeroSection({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">
          <SparklesIcon aria-hidden="true" />
          Photo journeys, mapped for you
        </p>

        <h1 id="hero-title">
          Your camera roll.
          <span>Your journey, mapped.</span>
        </h1>

        <p className="hero-intro">
          Upload a whole trip at once. Field Atlas finds places and dates, flags
          only what needs review, and turns your photos into private memories or
          a chapter.
        </p>

        <div className="hero-actions">
          <Link
            className="primary-action"
            href={
              isLoggedIn ? '/dashboard/import' : '/sign-up?intent=photo-import'
            }
          >
            {isLoggedIn ? 'Upload photos' : 'Start with your photos'}
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <a className="secondary-action" href="#photo-upload">
            See the 3-step flow
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
        aria-label="Five uploaded travel photos becoming four recognized places in a private atlas"
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
              <strong>5 photos selected</strong>
              <small>One trip · ready to map</small>
            </span>
          </div>
          <div className="hero-photo-stack">
            <span data-tone="river" />
            <span data-tone="lantern" />
            <span data-tone="trail" />
          </div>
          <div className="hero-field-note">
            <span className="field-note-index">Recognized for you</span>
            <strong>4 places across the map</strong>
            <span className="field-note-location">
              <CheckCircleIcon />
              Dates found · 1 place to review
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
