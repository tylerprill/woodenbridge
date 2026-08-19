'use client';

import { PhotoIcon } from '@heroicons/react/24/outline';
import type { RefObject } from 'react';
import { getImportStepIndex } from './photo-import-helpers';
import {
  IMPORT_STEPS,
  type ImportItem,
  type ImportStep,
} from './photo-import-types';
import styles from './photo-import.module.css';

export function ImportProgress({
  step,
  includeChapter,
}: {
  step: ImportStep;
  includeChapter: boolean;
}) {
  const visibleSteps = includeChapter ? IMPORT_STEPS : IMPORT_STEPS.slice(0, 3);
  const current = getImportStepIndex(step, includeChapter);

  return (
    <nav className={styles.stepper} aria-label="Photo import progress">
      <ol>
        {visibleSteps.map(([value, label], index) => (
          <li
            key={value}
            data-active={current === index ? 'true' : undefined}
            data-complete={current > index ? 'true' : undefined}
            aria-current={current === index ? 'step' : undefined}
          >
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      <p className={styles.mobileStep} aria-live="polite">
        Step {current + 1} of {visibleSteps.length} ·{' '}
        {visibleSteps[Math.min(current, visibleSteps.length - 1)]?.[1]}
      </p>
    </nav>
  );
}

export function ImportPhotoPreview({
  item,
  priority = false,
}: {
  item: ImportItem;
  priority?: boolean;
}) {
  if (!item.previewUrl) {
    return (
      <span className={styles.photoFallback} aria-hidden="true">
        <PhotoIcon />
      </span>
    );
  }
  return (
    // Object URLs are already bounded, metadata-free derivatives and cannot be
    // processed by Next's image optimizer. A native image is also more reliable
    // for transient Blob URLs in mobile Safari.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={styles.photoPreview}
      src={item.previewUrl}
      alt=""
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

export function ImportNotice({
  message,
  busy,
  progress,
  hasError,
}: {
  message: string;
  busy: boolean;
  progress: number;
  hasError: boolean;
}) {
  if (!message) return null;
  return (
    <div
      className={styles.notice}
      data-error={hasError ? 'true' : undefined}
      role={hasError ? 'alert' : 'status'}
      aria-live="polite"
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
      <p>{message}</p>
      {busy || progress ? (
        <div
          className={styles.progressBar}
          role="progressbar"
          aria-label="Photo journey progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function ImportHeading({
  step,
  activeCount,
  completionHasChapter,
  headingRef,
}: {
  step: ImportStep;
  activeCount: number;
  completionHasChapter: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <>
      <p className="section-kicker">Photo journey</p>
      <h1 ref={headingRef} tabIndex={-1}>
        {step === 'choose' && 'Let your camera roll find its way home.'}
        {step === 'review' && 'See where the journey took shape.'}
        {step === 'stories' && 'Give every place its voice.'}
        {step === 'chapter' && 'Bring the journey together.'}
        {step === 'complete' &&
          `${activeCount === 1 ? 'This memory has' : `${activeCount} memories have`} found ${activeCount === 1 ? 'its' : 'their'} place.`}
      </h1>
      <p>
        {step === 'choose' &&
          'Field Atlas reads the captured dates and GPS already kept inside your photographs, then asks you to confirm every memory.'}
        {step === 'review' &&
          'Every pin remains editable. Nothing becomes a memory until you approve the journey.'}
        {step === 'stories' &&
          'Add the title and small detail that make each photograph worth returning to.'}
        {step === 'chapter' &&
          'Keep the memories in their captured order, choose a cover, and name what connects them.'}
        {step === 'complete' &&
          (completionHasChapter
            ? 'Your private chapter is ready whenever you want to walk the route again.'
            : 'Your private Atlas is ready whenever you want to return.')}
      </p>
    </>
  );
}
