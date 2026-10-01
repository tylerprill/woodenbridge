'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsPointingOutIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import { useCallback, useEffect, useRef } from 'react';

import type { AtlasMedia } from '@/app/lib/atlas/definitions';
import styles from './memory-lightbox.module.css';

type MemoryLightboxProps = {
  photos: AtlasMedia[];
  activeIndex: number;
  open: boolean;
  title: string;
  place: string;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
};

export function MemoryLightbox({
  photos,
  activeIndex,
  open,
  title,
  place,
  onActiveIndexChange,
  onClose,
}: MemoryLightboxProps) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const photoCount = photos.length;
  const photo = photos[activeIndex];
  const hasCarousel = photoCount > 1;

  const move = useCallback(
    (direction: -1 | 1) => {
      if (!photoCount) return;
      onActiveIndexChange((activeIndex + direction + photoCount) % photoCount);
    },
    [activeIndex, onActiveIndexChange, photoCount],
  );

  useEffect(() => {
    if (!open || !hasCarousel) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        onActiveIndexChange(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onActiveIndexChange(photoCount - 1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasCarousel, move, onActiveIndexChange, open, photoCount]);

  useEffect(() => {
    if (!open || !hasCarousel) return;
    thumbnailRefs.current[activeIndex]?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeIndex, hasCarousel, open]);

  if (!photo) return null;

  const imageAlt =
    photo.altText.trim() ||
    `${title || place || 'Journey memory'}, photo ${activeIndex + 1}`;

  return (
    <Dialog open={open} onClose={onClose} className={styles.dialog}>
      <DialogBackdrop className={styles.backdrop} transition />
      <div className={styles.positioner}>
        <DialogPanel className={styles.panel} transition>
          <header className={styles.header}>
            <div className={styles.heading}>
              <span>
                <ArrowsPointingOutIcon aria-hidden="true" />
                Full image
              </span>
              <DialogTitle>{title || place || 'Journey memory'}</DialogTitle>
            </div>
            <div className={styles.headerActions}>
              <span
                className={styles.count}
                role="status"
                aria-label={`Photo ${activeIndex + 1} of ${photoCount}`}
              >
                <span aria-hidden="true">
                  <strong>{String(activeIndex + 1).padStart(2, '0')}</strong>
                  <span> / </span>
                  {String(photoCount).padStart(2, '0')}
                </span>
              </span>
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Close full image"
                data-autofocus
              >
                <XMarkIcon aria-hidden="true" />
              </button>
            </div>
          </header>

          <div
            className={styles.stage}
            onTouchStart={(event) => {
              const touch = event.touches[0];
              touchStart.current = touch
                ? { x: touch.clientX, y: touch.clientY }
                : null;
            }}
            onTouchEnd={(event) => {
              const start = touchStart.current;
              const touch = event.changedTouches[0];
              touchStart.current = null;
              if (!hasCarousel || !start || !touch) return;

              const horizontalDistance = touch.clientX - start.x;
              const verticalDistance = touch.clientY - start.y;
              if (
                Math.abs(horizontalDistance) >= 48 &&
                Math.abs(horizontalDistance) > Math.abs(verticalDistance) * 1.15
              ) {
                move(horizontalDistance > 0 ? -1 : 1);
              }
            }}
          >
            <div className={styles.ambient} aria-hidden="true">
              <Image
                key={`ambient-${photo.id}`}
                src={photo.deliveryUrl}
                alt=""
                fill
                sizes="100vw"
                unoptimized
              />
            </div>
            <div className={styles.imageFrame}>
              <Image
                key={photo.id}
                src={photo.deliveryUrl}
                alt={imageAlt}
                fill
                sizes="100vw"
                loading="eager"
                unoptimized
              />
            </div>

            {hasCarousel ? (
              <>
                <button
                  type="button"
                  className={`${styles.direction} ${styles.previous}`}
                  onClick={() => move(-1)}
                  aria-label="Show previous full-size photo"
                >
                  <ArrowLeftIcon aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${styles.direction} ${styles.next}`}
                  onClick={() => move(1)}
                  aria-label="Show next full-size photo"
                >
                  <ArrowRightIcon aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>

          <footer className={styles.footer}>
            <div className={styles.caption}>
              <span>Photo {String(activeIndex + 1).padStart(2, '0')}</span>
              <p>{place || title || 'A place held in this journey'}</p>
            </div>

            {hasCarousel ? (
              <div
                className={styles.thumbnails}
                role="group"
                aria-label="Choose a full-size photo"
              >
                {photos.map((candidate, candidateIndex) => (
                  <button
                    key={candidate.id}
                    ref={(node) => {
                      thumbnailRefs.current[candidateIndex] = node;
                    }}
                    type="button"
                    onClick={() => onActiveIndexChange(candidateIndex)}
                    aria-label={`Show full-size photo ${candidateIndex + 1} of ${photoCount}`}
                    aria-current={
                      candidateIndex === activeIndex ? 'true' : undefined
                    }
                  >
                    <Image
                      src={candidate.thumbnailUrl}
                      alt=""
                      fill
                      sizes="72px"
                      unoptimized
                    />
                    <span>{String(candidateIndex + 1).padStart(2, '0')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className={styles.soloHint}>Press Esc to return</span>
            )}
          </footer>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
