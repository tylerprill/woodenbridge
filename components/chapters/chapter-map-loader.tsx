'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import type { ChapterMapMemory } from './chapter-map';
import styles from './chapters.module.css';

const DeferredChapterMap = dynamic(
  () => import('./chapter-map').then((module) => module.ChapterMap),
  {
    ssr: false,
    loading: () => <ChapterMapPlaceholder label="Drawing your route" />,
  },
);

function ChapterMapPlaceholder({ label }: { label: string }) {
  return (
    <div className={styles.chapterMapFrame} aria-live="polite">
      <div className={styles.chapterMapDeferred} role="status">
        <div className={styles.chapterMapDeferredStatus}>
          <span aria-hidden="true" />
          <p>{label}</p>
        </div>
      </div>
    </div>
  );
}

export function ChapterMapLoader({ entries }: { entries: ChapterMapMemory[] }) {
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: '360px 0px', threshold: 0.01 },
    );
    observer.observe(boundary);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boundaryRef}>
      {shouldLoad ? (
        <DeferredChapterMap entries={entries} />
      ) : (
        <ChapterMapPlaceholder label="Route map ahead" />
      )}
    </div>
  );
}
