'use client';

import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';

import styles from './chapters.module.css';

export type ChapterSegmentIndexItem = {
  id: string;
  positionLabel: string;
  title: string;
  memoryLabel: string;
};

export type ChapterSegmentGroup = {
  key: string;
  segmentId: string | null;
  targetId: string;
  eyebrow: string;
  title: string;
  meta: string;
  empty: boolean;
  addMemoryHref?: string;
  content: ReactNode;
};

type PendingNavigation = {
  targetId: string;
  moveFocus: boolean;
};

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function ChapterSegmentedTimeline({
  segments,
  groups,
}: {
  segments: ChapterSegmentIndexItem[];
  groups: ChapterSegmentGroup[];
}) {
  const [expandedGroupIds, setExpandedGroupIds] = useState(() => {
    const latestSegmentId = segments.at(-1)?.id;
    const latestSegmentGroup = groups.find(
      (group) => group.segmentId === latestSegmentId,
    );

    return new Set(latestSegmentGroup ? [latestSegmentGroup.key] : []);
  });
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);

  const revealGroup = useCallback(
    (group: ChapterSegmentGroup, moveFocus: boolean) => {
      setExpandedGroupIds((current) => {
        if (current.has(group.key)) return current;
        const next = new Set(current);
        next.add(group.key);
        return next;
      });
      setSelectedSegmentId(group.segmentId);
      setPendingNavigation({ targetId: group.targetId, moveFocus });
    },
    [],
  );

  const revealSegment = useCallback(
    (segmentId: string, moveFocus: boolean) => {
      const group = groups.find(
        (candidate) => candidate.segmentId === segmentId,
      );
      if (!group) return;

      revealGroup(group, moveFocus);
    },
    [groups, revealGroup],
  );

  useEffect(() => {
    function revealHashTarget() {
      const targetId = window.location.hash.slice(1);
      const group = groups.find((candidate) => candidate.targetId === targetId);
      if (group) {
        revealGroup(group, false);
        return;
      }
      setSelectedSegmentId(null);
      setPendingNavigation(null);
    }

    revealHashTarget();
    window.addEventListener('hashchange', revealHashTarget);
    window.addEventListener('popstate', revealHashTarget);
    return () => {
      window.removeEventListener('hashchange', revealHashTarget);
      window.removeEventListener('popstate', revealHashTarget);
    };
  }, [groups, revealGroup]);

  useEffect(() => {
    if (!pendingNavigation) return;

    let settleTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(pendingNavigation.targetId);
      if (!target) {
        setPendingNavigation(null);
        return;
      }

      const reduceMotion = Boolean(
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      );
      target.scrollIntoView?.({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      if (pendingNavigation.moveFocus) {
        target
          .querySelector<HTMLButtonElement>('[data-journey-segment-toggle]')
          ?.focus({ preventScroll: true });
      }

      // Opening the last Segment can materialize an off-screen memory card
      // after the first scroll. Correct once the layout has settled so short
      // landscape windows finish on the Segment heading instead of the card.
      settleTimer = window.setTimeout(
        () => {
          target.scrollIntoView?.({ behavior: 'auto', block: 'start' });
          setPendingNavigation(null);
        },
        reduceMotion ? 0 : 600,
      );
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [pendingNavigation]);

  function selectSegment(
    event: MouseEvent<HTMLAnchorElement>,
    segmentId: string,
    targetId: string,
  ) {
    if (!isPlainPrimaryClick(event)) return;

    event.preventDefault();
    const hash = `#${targetId}`;
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    revealSegment(segmentId, true);
  }

  function toggleGroup(groupKey: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  return (
    <>
      <nav className={styles.journeySegmentIndex} aria-label="Journey segments">
        <ol>
          {segments.map((segment) => {
            const targetId = `journey-segment-${segment.id}`;
            return (
              <li key={segment.id}>
                <a
                  href={`#${targetId}`}
                  aria-current={
                    selectedSegmentId === segment.id ? 'location' : undefined
                  }
                  onClick={(event) =>
                    selectSegment(event, segment.id, targetId)
                  }
                >
                  <span>{segment.positionLabel}</span>
                  <strong>{segment.title}</strong>
                  <small>{segment.memoryLabel}</small>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <ol
        className={`${styles.chapterTimeline} ${styles.segmentedChapterTimeline}`}
        aria-label="Journey memories in route order"
      >
        {groups.map((group) => {
          const isExpanded = expandedGroupIds.has(group.key);
          const panelId = `${group.targetId}-memories`;

          return (
            <li
              className={styles.journeySegmentGroup}
              data-expanded={isExpanded ? 'true' : 'false'}
              key={group.key}
            >
              <div>
                <div
                  id={group.targetId}
                  className={styles.journeySegmentHeading}
                  data-expanded={isExpanded ? 'true' : 'false'}
                >
                  <div className={styles.journeySegmentSummary}>
                    <span className={styles.journeySegmentEyebrow}>
                      {group.eyebrow}
                    </span>
                    <h3>
                      <button
                        type="button"
                        className={styles.journeySegmentToggle}
                        aria-label={`${group.eyebrow}: ${group.title}`}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        data-journey-segment-toggle
                        onClick={() => toggleGroup(group.key)}
                      >
                        <span>{group.title}</span>
                        <ChevronDownIcon aria-hidden="true" />
                      </button>
                    </h3>
                    <p>{group.meta}</p>
                  </div>
                  {group.addMemoryHref ? (
                    <Link href={group.addMemoryHref}>
                      <PlusIcon aria-hidden="true" />
                      <span>Add memory</span>
                    </Link>
                  ) : null}
                </div>
                <div
                  id={panelId}
                  className={styles.journeySegmentPanel}
                  hidden={!isExpanded}
                >
                  <ol
                    className={styles.chapterSegmentStops}
                    aria-label={`${group.eyebrow}: ${group.title} memories`}
                    data-empty={group.empty ? 'true' : 'false'}
                  >
                    {group.content}
                  </ol>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
