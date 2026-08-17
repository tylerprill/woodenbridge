'use client';

import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

import styles from './chapters.module.css';

export type ChapterSaveNoticeKind = 'created' | 'updated';

export function ChapterSaveNotice({
  chapterId,
  kind,
}: {
  chapterId: string;
  kind: ChapterSaveNoticeKind;
}) {
  const [visible, setVisible] = useState(true);

  function removeSaveMarker() {
    window.history.replaceState(
      window.history.state,
      '',
      `/dashboard/chapters/${chapterId}`,
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      window.history.replaceState(
        window.history.state,
        '',
        `/dashboard/chapters/${chapterId}`,
      );
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [chapterId]);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    removeSaveMarker();
  }

  return (
    <div className={styles.chapterSaveNotice} role="status">
      <span aria-hidden="true">
        <CheckIcon />
      </span>
      <div>
        <strong>
          {kind === 'created' ? 'Chapter created.' : 'Changes saved.'}
        </strong>
        <p>Your latest chapter is safely in your atlas.</p>
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
