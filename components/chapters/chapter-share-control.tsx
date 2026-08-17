'use client';

import { CheckIcon, LinkIcon, ShareIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { ChapterVisibility } from '@/app/lib/chapters/definitions';
import styles from './chapters.module.css';

type ShareFeedback = 'idle' | 'sharing' | 'shared' | 'copied' | 'error';

export function ChapterShareControl({
  chapterId,
  chapterTitle,
  shareId,
  visibility,
}: {
  chapterId: string;
  chapterTitle: string;
  shareId: string;
  visibility: ChapterVisibility;
}) {
  const [feedback, setFeedback] = useState<ShareFeedback>('idle');
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  if (visibility === 'private') {
    return (
      <Link
        href={`/dashboard/chapters/${chapterId}/edit?step=arrange#chapter-sharing-heading`}
        className={styles.chapterPrivateAction}
      >
        <LinkIcon aria-hidden="true" />
        Share
      </Link>
    );
  }

  function showTransientFeedback(next: 'shared' | 'copied') {
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    setFeedback(next);
    feedbackTimer.current = window.setTimeout(() => {
      setFeedback('idle');
      feedbackTimer.current = null;
    }, 3200);
  }

  function chapterUrl() {
    return `${window.location.origin}/shared/chapters/${shareId}`;
  }

  async function shareChapter() {
    const url = chapterUrl();
    setFeedback('sharing');

    if (navigator.share && navigator.maxTouchPoints > 0) {
      try {
        await navigator.share({ title: chapterTitle, url });
        showTransientFeedback('shared');
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          setFeedback('idle');
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showTransientFeedback('copied');
    } catch {
      setFeedback('error');
    }
  }

  return (
    <div className={styles.chapterShareControl}>
      <button
        type="button"
        className={styles.chapterShareAction}
        onClick={shareChapter}
        disabled={feedback === 'sharing'}
        aria-busy={feedback === 'sharing'}
        title="Share chapter"
      >
        {feedback === 'shared' || feedback === 'copied' ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <ShareIcon aria-hidden="true" />
        )}
        {feedback === 'sharing'
          ? 'Preparing…'
          : feedback === 'shared'
            ? 'Shared'
            : feedback === 'copied'
              ? 'Link copied'
              : 'Share'}
      </button>
      {feedback !== 'idle' && feedback !== 'sharing' ? (
        <div
          className={styles.chapterShareFeedback}
          data-error={feedback === 'error' ? 'true' : undefined}
          role={feedback === 'error' ? 'alert' : 'status'}
        >
          <span>
            {feedback === 'shared'
              ? 'Chapter shared.'
              : feedback === 'copied'
                ? 'Private link copied.'
                : 'Copy was blocked.'}
          </span>
          {feedback === 'error' ? (
            <button
              type="button"
              onClick={() =>
                window.prompt('Copy this chapter link:', chapterUrl())
              }
            >
              Show link
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
