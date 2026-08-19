'use client';

import {
  ArrowRightIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PhotoIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { RefObject } from 'react';
import { ImportPhotoPreview } from './photo-import-ui';
import { MAX_IMPORT_PHOTOS, type ImportItem } from './photo-import-types';
import styles from './photo-import.module.css';

export function PhotoImportChooseStep({
  items,
  activeCount,
  totalSize,
  busy,
  selectionLocked,
  inputRef,
  rejections,
  onChoose,
  onRemove,
  onContinue,
}: {
  items: ImportItem[];
  activeCount: number;
  totalSize: string;
  busy: boolean;
  selectionLocked: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  rejections: string[];
  onChoose: (files: File[]) => void;
  onRemove: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <main className={styles.chooseLayout}>
      <section className={styles.dropCard} aria-labelledby="photo-picker-title">
        <div className={styles.dropArt} aria-hidden="true">
          <span />
          <span />
          <span />
          <PhotoIcon />
        </div>
        <p className="section-kicker">Begin with the photographs</p>
        <h2 id="photo-picker-title">Choose one trip at a time.</h2>
        <p>
          Select up to {MAX_IMPORT_PHOTOS} photographs. Captured dates, GPS
          confidence, and recognized places stay reviewable before anything is
          added to your atlas.
        </p>
        <label className={styles.fileButton}>
          <PlusIcon aria-hidden="true" />
          {items.length ? 'Add more photos' : 'Choose photos'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            disabled={
              busy || selectionLocked || items.length >= MAX_IMPORT_PHOTOS
            }
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) onChoose(files);
            }}
          />
        </label>
        <small>JPG, PNG, WebP, and HEIC · Up to 25 MB each</small>
      </section>

      <section
        className={styles.selectionCard}
        aria-labelledby="selection-title"
      >
        <div className={styles.selectionHeading}>
          <div>
            <p className="section-kicker">Your selection</p>
            <h2 id="selection-title">
              {items.length
                ? `${items.length} ${items.length === 1 ? 'photograph' : 'photographs'}`
                : 'The first frame is waiting.'}
            </h2>
          </div>
          {items.length ? <span>{totalSize}</span> : null}
        </div>
        {items.length ? (
          <div className={styles.photoMosaic}>
            {items.slice(0, 12).map((item, index) => (
              <figure
                key={item.clientItemId}
                aria-busy={
                  item.state === 'analyzing' || item.state === 'locating'
                }
              >
                <ImportPhotoPreview item={item} priority={index < 2} />
                <button
                  type="button"
                  onClick={() => onRemove(item.clientItemId)}
                  aria-label={`Remove ${item.fileName}`}
                >
                  <XMarkIcon aria-hidden="true" />
                </button>
              </figure>
            ))}
            {items.length > 12 ? (
              <span className={styles.morePhotos}>+{items.length - 12}</span>
            ) : null}
          </div>
        ) : (
          <div className={styles.selectionEmpty}>
            <span aria-hidden="true" />
            <p>Your chosen photographs will gather here.</p>
          </div>
        )}
        {rejections.length ? (
          <div className={styles.rejections} role="alert">
            <ExclamationTriangleIcon aria-hidden="true" />
            <div>
              <strong>Some photographs need attention.</strong>
              {rejections.map((rejection) => (
                <p key={rejection}>{rejection}</p>
              ))}
            </div>
          </div>
        ) : null}
        <div className={styles.privacyPromise}>
          <LockClosedIcon aria-hidden="true" />
          <p>
            <strong>Private by default.</strong>
            Photos stay on this device during review. Exact GPS is disclosed to
            the configured geocoder only to find a place, then stored privately
            in your account. Shared chapters never reveal precise pins unless
            you explicitly enable map precision.
          </p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!activeCount || busy}
          onClick={onContinue}
        >
          {busy ? 'Reading photographs…' : 'Find the journey'}
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
