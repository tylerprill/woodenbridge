'use client';

import { CheckIcon, LinkIcon, ShareIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useState } from 'react';

import type { ChapterVisibility } from '@/app/lib/chapters/definitions';
import styles from './chapters.module.css';

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
  const [copied, setCopied] = useState(false);

  if (visibility === 'private') {
    return (
      <Link
        href={`/dashboard/chapters/${chapterId}/edit#chapter-sharing-heading`}
        className={styles.chapterPrivateAction}
      >
        <LinkIcon aria-hidden="true" />
        Share
      </Link>
    );
  }

  async function shareChapter() {
    const url = `${window.location.origin}/shared/chapters/${shareId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: chapterTitle, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      window.prompt('Copy this chapter link:', url);
    }
  }

  return (
    <button
      type="button"
      className={styles.chapterShareAction}
      onClick={shareChapter}
      aria-live="polite"
    >
      {copied ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <ShareIcon aria-hidden="true" />
      )}
      {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
