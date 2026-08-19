'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CheckCircleIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import { formatImportDate } from './photo-import-helpers';
import type { ImportItem } from './photo-import-types';
import { ImportPhotoPreview } from './photo-import-ui';
import styles from './photo-import.module.css';

export function PhotoImportChapterStep({
  items,
  coverClientItemId,
  chapterTitle,
  chapterIntroduction,
  busy,
  locked,
  lockedCreateChapter,
  onCover,
  onTitle,
  onIntroduction,
  onMove,
  onBack,
  onCreateMemories,
  onCreateChapter,
}: {
  items: ImportItem[];
  coverClientItemId: string | null;
  chapterTitle: string;
  chapterIntroduction: string;
  busy: boolean;
  locked: boolean;
  lockedCreateChapter: boolean | null;
  onCover: (id: string) => void;
  onTitle: (value: string) => void;
  onIntroduction: (value: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onBack: () => void;
  onCreateMemories: () => void;
  onCreateChapter: () => void;
}) {
  return (
    <main className={styles.chapterLayout}>
      <section
        className={styles.chapterCover}
        aria-label="Choose chapter cover"
      >
        {items.map((item, index) => (
          <button
            type="button"
            key={item.clientItemId}
            data-selected={
              coverClientItemId === item.clientItemId ? 'true' : undefined
            }
            onClick={() => onCover(item.clientItemId)}
            disabled={locked}
            aria-label={`Use ${item.title || item.placeLabel} as chapter cover`}
          >
            <ImportPhotoPreview item={item} priority={index === 0} />
            {coverClientItemId === item.clientItemId ? (
              <span>
                <CheckCircleIcon aria-hidden="true" /> Cover
              </span>
            ) : null}
          </button>
        ))}
      </section>
      <section
        className={styles.chapterForm}
        aria-labelledby="chapter-form-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className="section-kicker">Bring it together</p>
            <h2 id="chapter-form-title">Give this journey a chapter.</h2>
          </div>
          <span className={styles.privateBadge}>
            <LockClosedIcon aria-hidden="true" /> Private
          </span>
        </div>
        <div className={styles.editorField}>
          <label htmlFor="import-chapter-title">Chapter title</label>
          <input
            id="import-chapter-title"
            value={chapterTitle}
            maxLength={100}
            placeholder="A journey worth returning to"
            autoComplete="off"
            disabled={locked}
            onChange={(event) => onTitle(event.target.value)}
          />
          <small>{chapterTitle.length} / 100</small>
        </div>
        <div className={styles.editorField}>
          <label htmlFor="import-chapter-introduction">
            Introduction <em>Optional</em>
          </label>
          <textarea
            id="import-chapter-introduction"
            value={chapterIntroduction}
            maxLength={1200}
            rows={5}
            disabled={locked}
            placeholder="A few words about what made this journey matter…"
            onChange={(event) => onIntroduction(event.target.value)}
          />
          <small>{chapterIntroduction.length} / 1200</small>
        </div>
        <div className={styles.chapterPrivacy}>
          <LockClosedIcon aria-hidden="true" />
          <p>
            <strong>This chapter begins private.</strong>
            You can choose an unlisted sharing link after reviewing it.
          </p>
        </div>
      </section>
      <section
        className={styles.chapterOrder}
        aria-labelledby="chapter-order-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className="section-kicker">Captured order</p>
            <h2 id="chapter-order-title">The route.</h2>
          </div>
        </div>
        <ol>
          {items.map((item, index) => (
            <li key={item.clientItemId}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <figure>
                <ImportPhotoPreview item={item} />
              </figure>
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.placeLabel} · {formatImportDate(item.visitedOn)}
                </small>
              </div>
              <div>
                <button
                  type="button"
                  disabled={index === 0 || locked}
                  onClick={() => onMove(item.clientItemId, -1)}
                  aria-label={`Move ${item.title} earlier`}
                >
                  <ArrowUpIcon aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1 || locked}
                  onClick={() => onMove(item.clientItemId, 1)}
                  aria-label={`Move ${item.title} later`}
                >
                  <ArrowDownIcon aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <footer className={styles.actionBar}>
        <button type="button" onClick={onBack} disabled={locked}>
          <ArrowLeftIcon aria-hidden="true" /> Return to memories
        </button>
        <div className={styles.finalActions}>
          {lockedCreateChapter !== true ? (
            <button type="button" onClick={onCreateMemories} disabled={busy}>
              Create memories only
            </button>
          ) : null}
          {lockedCreateChapter !== false ? (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || !chapterTitle.trim()}
              onClick={onCreateChapter}
            >
              {busy
                ? 'Creating journey…'
                : `Create ${items.length} memories and 1 chapter`}
              <ArrowRightIcon aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </footer>
    </main>
  );
}
