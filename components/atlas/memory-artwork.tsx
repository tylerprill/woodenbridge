'use client';

import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import { useRef, useState } from 'react';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import { getAtlasPlaceContextLabel } from '@/app/lib/atlas/place';
import { BridgeScene } from '@/components/clean/bridge-scene';

type MemoryArtworkProps = {
  entry: AtlasEntry;
  index?: string;
  tone: 'alpine' | 'cedar' | 'ember';
  sizes?: string;
  eager?: boolean;
};

export function MemoryArtwork({
  entry,
  index,
  tone,
  sizes,
  eager = false,
}: MemoryArtworkProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const photos = entry.media;
  const photoCount = photos.length;
  const photo = photos[activeIndex];
  const hasCarousel = photoCount > 1;
  const context = getAtlasPlaceContextLabel(entry);

  function move(direction: -1 | 1) {
    setActiveIndex(
      (current) => (current + direction + photoCount) % photoCount,
    );
  }

  const visual = photo ? (
    <Image
      key={photo.id}
      src={photo.deliveryUrl}
      alt={`${photo.altText.trim() || entry.title.trim() || context}${hasCarousel ? `, photo ${activeIndex + 1} of ${photoCount}` : ''}`}
      fill
      sizes={sizes ?? '(max-width: 768px) 100vw, 33vw'}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      unoptimized
    />
  ) : (
    <BridgeScene className="atlas-memory-artwork-fallback" tone={tone} />
  );

  return (
    <div
      className="atlas-memory-artwork"
      role={hasCarousel ? 'region' : undefined}
      aria-roledescription={hasCarousel ? 'carousel' : undefined}
      aria-label={hasCarousel ? `${entry.title || context} photos` : undefined}
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        const end = event.changedTouches[0]?.clientX;
        touchStartX.current = null;
        if (!hasCarousel || start === null || end === undefined) return;

        const distance = end - start;
        if (Math.abs(distance) >= 36) move(distance > 0 ? -1 : 1);
      }}
    >
      {visual}

      {index ? (
        <span className="atlas-memory-artwork-index">{index}</span>
      ) : null}

      {hasCarousel ? (
        <>
          <button
            className="atlas-carousel-control atlas-carousel-control-previous"
            type="button"
            onClick={() => move(-1)}
            aria-label="Show previous photo"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </button>
          <button
            className="atlas-carousel-control atlas-carousel-control-next"
            type="button"
            onClick={() => move(1)}
            aria-label="Show next photo"
          >
            <ChevronRightIcon aria-hidden="true" />
          </button>
          <div
            className="atlas-carousel-dots"
            role="group"
            aria-label="Choose a photo"
          >
            {photos.map((candidate, candidateIndex) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setActiveIndex(candidateIndex)}
                aria-label={`Show photo ${candidateIndex + 1} of ${photoCount}`}
                aria-current={
                  candidateIndex === activeIndex ? 'true' : undefined
                }
              />
            ))}
          </div>
          <span className="atlas-carousel-count" aria-live="polite">
            {activeIndex + 1} / {photoCount}
          </span>
        </>
      ) : null}
    </div>
  );
}
