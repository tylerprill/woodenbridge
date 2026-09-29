'use client';

import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import styles from './chapters.module.css';

export type ChapterSaveNoticeKind = 'created' | 'updated' | 'continued';

function clearSaveMarker(chapterId: string) {
  const url = new URL(window.location.href);
  url.pathname = `/dashboard/chapters/${chapterId}`;
  url.searchParams.delete('saved');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function ChapterSaveNotice({
  chapterId,
  kind,
}: {
  chapterId: string;
  kind: ChapterSaveNoticeKind;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      clearSaveMarker(chapterId);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [chapterId]);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    clearSaveMarker(chapterId);
  }

  return (
    <div className={styles.chapterSaveNotice} role="status">
      <span aria-hidden="true">
        <CheckIcon />
      </span>
      <div>
        <strong>
          {kind === 'created'
            ? 'Journey created.'
            : kind === 'continued'
              ? 'Memory added.'
              : 'Changes saved.'}
        </strong>
        <p>
          {kind === 'continued'
            ? 'Your new memory is now part of this journey.'
            : 'Your latest journey is safely in your atlas.'}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss save confirmation"
      >
        <XMarkIcon aria-hidden="true" />
      </button>
    </div>
  );
}
