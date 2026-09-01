'use client';

import {
  ArrowRightIcon,
  CameraIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PhotoIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useRef, useState, type RefObject } from 'react';
import { ImportPhotoPreview } from './photo-import-ui';
import { MAX_IMPORT_PHOTOS, type ImportItem } from './photo-import-types';
import styles from './photo-import.module.css';

function selectionStatus(item: ImportItem) {
  if (item.state === 'analyzing') return 'Reading';
  if (item.state === 'locating') return 'Finding place';
  if (item.state === 'duplicate') return 'Duplicate';
  if (item.state === 'error') return 'Could not read';
  if (item.state === 'needs-place') return 'Needs place';
  return 'Ready';
}

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
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);
  const selectionFull = items.length >= MAX_IMPORT_PHOTOS;
  const selectionDisabled = busy || selectionLocked || selectionFull;
  const attentionCount = items.filter(
    (item) =>
      item.state === 'needs-place' ||
      item.state === 'duplicate' ||
      item.state === 'error',
  ).length;

  const chooseDroppedFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length && !selectionDisabled) onChoose(selected);
  };

  return (
    <main className={styles.chooseLayout}>
      <section
        className={styles.dropCard}
        aria-labelledby="photo-picker-title"
        data-dragging={dragging ? 'true' : undefined}
        onDragEnter={(event) => {
          if (selectionDisabled) return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (selectionDisabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(event) => {
          if (selectionDisabled) return;
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (!dragDepthRef.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragging(false);
          chooseDroppedFiles(event.dataTransfer.files);
        }}
      >
        <div className={styles.dropArt} aria-hidden="true">
          <span />
          <span />
          <span />
          <PhotoIcon />
        </div>
        <p className="section-kicker">Begin with the photographs</p>
        <h2 id="photo-picker-title">
          {dragging ? 'Drop them right here.' : 'Upload a journey.'}
        </h2>
        <p>
          Drop photos here or choose up to {MAX_IMPORT_PHOTOS} from your device.
          Dates and places are suggested automatically, and only items that need
          your attention will block saving.
        </p>
        <div className={styles.sourceActions}>
          <label className={styles.fileButton}>
            <PlusIcon aria-hidden="true" />
            {items.length ? 'Add more photos' : 'Choose photos'}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              disabled={selectionDisabled}
              onChange={(event) => chooseDroppedFiles(event.target.files)}
            />
          </label>
          <label className={styles.cameraButton}>
            <CameraIcon aria-hidden="true" /> Take a photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={selectionDisabled}
              onChange={(event) => {
                chooseDroppedFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <small>
          JPG, PNG, WebP, HEIC, or HEIF · Up to 25 MB each · Private until you
          save
        </small>
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
                ? `${items.length} ${items.length === 1 ? 'photo' : 'photos'} selected`
                : 'The first frame is waiting.'}
            </h2>
            {attentionCount ? (
              <p className={styles.selectionIssues}>
                {attentionCount} {attentionCount === 1 ? 'needs' : 'need'}{' '}
                attention
              </p>
            ) : null}
          </div>
          {items.length ? <span>{totalSize}</span> : null}
        </div>
        {items.length ? (
          <div className={styles.photoMosaic}>
            {items.map((item, index) => (
              <figure
                key={item.clientItemId}
                data-state={item.state}
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
                <figcaption>{selectionStatus(item)}</figcaption>
              </figure>
            ))}
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
          {busy
            ? 'Reading photographs…'
            : `Review ${activeCount} ${activeCount === 1 ? 'photo' : 'photos'}`}
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
