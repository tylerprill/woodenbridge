import {
  ArrowUpRightIcon,
  CalendarDaysIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
} from '@/app/lib/atlas/place';
import { MemoryArtwork } from './memory-artwork';

type KeepsakeTone = 'alpine' | 'cedar' | 'ember';
type KeepsakeVariant = 'grid' | 'row' | 'feature';

type KeepsakeCardProps = {
  entry: AtlasEntry;
  tone?: KeepsakeTone;
  index?: string;
  variant?: KeepsakeVariant;
  href?: string;
  eager?: boolean;
};

function getKeepsakeTone(entry: AtlasEntry): KeepsakeTone {
  const placeKey =
    [
      entry.placeLocality,
      entry.placeRegion,
      entry.placeCountryCode,
      entry.placeName,
    ]
      .filter(Boolean)
      .join('|') || entry.id;
  const hash = Array.from(placeKey).reduce(
    (current, character) => (current * 31 + character.charCodeAt(0)) | 0,
    0,
  );
  const tones: KeepsakeTone[] = ['alpine', 'cedar', 'ember'];
  return tones[Math.abs(hash) % tones.length];
}

function CardContents({
  entry,
  tone,
  index,
  variant,
  href,
  eager,
}: Omit<KeepsakeCardProps, 'tone'> & {
  tone: KeepsakeTone;
  variant: KeepsakeVariant;
}) {
  const place = getAtlasPlaceContextLabel(entry);
  const date = formatAtlasDate(entry);
  const title = entry.title || 'Untitled place';
  const description =
    entry.description || 'A place held quietly in your atlas.';
  const status = entry.journeyState === 'visited' ? 'Remembered' : 'Ahead';

  if (variant === 'row') {
    const copy = (
      <>
        <div className="keepsake-card-row-copy">
          {index ? <span className="keepsake-card-index">{index}</span> : null}
          <h3>{title}</h3>
          <p className="keepsake-card-location">
            <MapPinIcon aria-hidden="true" />
            <span>{place}</span>
          </p>
          <div className="keepsake-card-meta-main">
            <span>
              <CalendarDaysIcon aria-hidden="true" />
              {date}
            </span>
            <small>{status}</small>
          </div>
        </div>
        <ArrowUpRightIcon
          className="keepsake-card-row-arrow"
          aria-hidden="true"
        />
      </>
    );

    return (
      <>
        <MemoryArtwork
          entry={entry}
          tone={tone}
          eager={eager ?? index === '01'}
          preview
          sizes="(max-width: 768px) 25vw, 4.8rem"
        />
        {href ? (
          <Link
            className="keepsake-card-link keepsake-card-row-link"
            href={href}
            aria-label={`Open ${title} keepsake — ${place}`}
          >
            {copy}
          </Link>
        ) : (
          <div className="keepsake-card-row-link">{copy}</div>
        )}
      </>
    );
  }

  const copy = (
    <div className={`keepsake-card-copy keepsake-card-copy-${variant}`}>
      {variant === 'feature' ? (
        <p className="section-kicker">Field note</p>
      ) : null}
      <h2>{title}</h2>
      <p className="keepsake-card-location keepsake-card-location-prominent">
        <MapPinIcon aria-hidden="true" />
        <span>{place}</span>
      </p>
      <p className="keepsake-card-description">{description}</p>
      <div className="keepsake-card-meta">
        <div className="keepsake-card-meta-main">
          <span>
            <CalendarDaysIcon aria-hidden="true" />
            {date}
          </span>
          <small>{status}</small>
        </div>
        {variant === 'grid' ? <ArrowUpRightIcon aria-hidden="true" /> : null}
      </div>
    </div>
  );

  return (
    <>
      <MemoryArtwork
        entry={entry}
        index={index}
        tone={tone}
        eager={eager ?? (variant === 'feature' || index === '01')}
        preview={variant !== 'feature'}
        sizes={
          variant === 'feature'
            ? '(max-width: 768px) 100vw, 48rem'
            : '(max-width: 768px) 100vw, 33vw'
        }
      />
      {href ? (
        <Link
          className="keepsake-card-link"
          href={href}
          aria-label={`Open ${title} keepsake — ${place}`}
        >
          {copy}
        </Link>
      ) : (
        copy
      )}
    </>
  );
}

export function KeepsakeCard({
  entry,
  tone,
  index,
  variant = 'grid',
  href,
  eager,
}: KeepsakeCardProps) {
  const className = `keepsake-card keepsake-card-${variant}`;
  const resolvedTone = tone ?? getKeepsakeTone(entry);
  const contents = (
    <CardContents
      entry={entry}
      tone={resolvedTone}
      index={index}
      variant={variant}
      href={href}
      eager={eager}
    />
  );

  return (
    <article
      className={className}
      data-has-carousel={entry.media.length > 1 ? 'true' : undefined}
    >
      {contents}
    </article>
  );
}
