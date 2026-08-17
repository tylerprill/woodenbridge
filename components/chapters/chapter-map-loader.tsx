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

function ChapterMapPlaceholder({
  label,
  onLoad,
}: {
  label: string;
  onLoad?: () => void;
}) {
  return (
    <div className={styles.chapterMapFrame} aria-live="polite">
      <div className={styles.chapterMapDeferred} role="status">
        <div className={styles.chapterMapDeferredStatus}>
          <span aria-hidden="true" />
          <p>{label}</p>
          {onLoad ? (
            <button
              type="button"
              className={styles.chapterMapDeferredAction}
              onClick={onLoad}
            >
              Show route map
            </button>
          ) : null}
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
    if (
      window.location.hash === '#chapter-route' ||
      !boundary ||
      typeof IntersectionObserver === 'undefined'
    ) {
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

    const loadLinkedRoute = () => {
      if (window.location.hash !== '#chapter-route') return;
      setShouldLoad(true);
      observer.disconnect();
    };
    window.addEventListener('hashchange', loadLinkedRoute);

    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', loadLinkedRoute);
    };
  }, []);

  return (
    <div ref={boundaryRef}>
      {shouldLoad ? (
        <DeferredChapterMap entries={entries} />
      ) : (
        <ChapterMapPlaceholder
          label="Route map ahead"
          onLoad={() => setShouldLoad(true)}
        />
      )}
    </div>
  );
}
