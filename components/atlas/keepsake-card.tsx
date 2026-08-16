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
    return (
      <>
        <MemoryArtwork
          entry={entry}
          tone={tone}
          sizes="(max-width: 768px) 25vw, 4.8rem"
        />
        <div className="keepsake-card-row-copy">
          {index ? <span className="keepsake-card-index">{index}</span> : null}
          <h3>{title}</h3>
          <p className="keepsake-card-location">
            <MapPinIcon aria-hidden="true" />
            {place}
          </p>
          <p className="keepsake-card-row-meta">
            {status} · {date}
          </p>
        </div>
        <ArrowUpRightIcon
          className="keepsake-card-row-arrow"
          aria-hidden="true"
        />
      </>
    );
  }

  return (
    <>
      <MemoryArtwork
        entry={entry}
        index={index}
        tone={tone}
        sizes={
          variant === 'feature'
            ? '(max-width: 768px) 100vw, 48rem'
            : '(max-width: 768px) 100vw, 33vw'
        }
      />
      <div className={`keepsake-card-copy keepsake-card-copy-${variant}`}>
        <div className="keepsake-card-topline">
          <p className="bridge-location">
            <MapPinIcon aria-hidden="true" />
            <span>{place}</span>
          </p>
          <span className="keepsake-card-status">{status}</span>
        </div>
        {variant === 'feature' ? (
          <p className="section-kicker">Field note</p>
        ) : null}
        <h2>{title}</h2>
        <p className="keepsake-card-description">{description}</p>
        <div className="keepsake-card-meta">
          <span>
            <CalendarDaysIcon aria-hidden="true" />
            {date}
          </span>
          {variant === 'grid' ? <ArrowUpRightIcon aria-hidden="true" /> : null}
        </div>
      </div>
    </>
  );
}

export function KeepsakeCard({
  entry,
  tone,
  index,
  variant = 'grid',
  href,
}: KeepsakeCardProps) {
  const className = `keepsake-card keepsake-card-${variant}`;
  const resolvedTone = tone ?? getKeepsakeTone(entry);
  const label = `Open ${entry.title || 'Untitled place'} keepsake — ${getAtlasPlaceContextLabel(entry)}`;
  const contents = (
    <CardContents
      entry={entry}
      tone={resolvedTone}
      index={index}
      variant={variant}
    />
  );

  if (href) {
    return (
      <Link className={className} href={href} aria-label={label}>
        {contents}
      </Link>
    );
  }

  return <article className={className}>{contents}</article>;
}
