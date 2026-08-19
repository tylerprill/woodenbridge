'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import {
  formatImportDate,
  getImportStatusCopy,
  needsFileDateConfirmation,
} from './photo-import-helpers';
import type { ImportItem, UpdateImportItem } from './photo-import-types';
import { ImportPhotoPreview } from './photo-import-ui';
import styles from './photo-import.module.css';

export function PhotoImportStoriesStep({
  items,
  currentItem,
  storyIndex,
  completedStories,
  includeChapter,
  busy,
  locked,
  updateItem,
  onStoryIndex,
  onEditLocation,
  onBack,
  onContinue,
}: {
  items: ImportItem[];
  currentItem: ImportItem;
  storyIndex: number;
  completedStories: number;
  includeChapter: boolean;
  busy: boolean;
  locked: boolean;
  updateItem: UpdateImportItem;
  onStoryIndex: (index: number) => void;
  onEditLocation: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <main className={styles.storyLayout}>
      <section
        className={styles.storyPhoto}
        aria-label={`Photograph for memory ${storyIndex + 1}`}
      >
        <figure>
          <ImportPhotoPreview item={currentItem} priority />
        </figure>
        <div className={styles.storyPhotoMeta}>
          <span>{formatImportDate(currentItem.visitedOn)}</span>
          <span>{getImportStatusCopy(currentItem)}</span>
        </div>
      </section>
      <section className={styles.storyForm} aria-labelledby="story-form-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className="section-kicker">
              Memory {storyIndex + 1} of {items.length}
            </p>
            <h2 id="story-form-title">
              {currentItem.placeLabel || 'Name this place.'}
            </h2>
          </div>
          <span className={styles.storyCompletion}>
            {completedStories} of {items.length} ready
          </span>
        </div>
        <div className={styles.editorField}>
          <label htmlFor="import-memory-title">Title</label>
          <input
            id="import-memory-title"
            value={currentItem.title}
            maxLength={80}
            placeholder="Name this memory"
            autoComplete="off"
            autoCapitalize="words"
            disabled={locked}
            onChange={(event) =>
              updateItem(currentItem.clientItemId, {
                title: event.target.value,
              })
            }
          />
          <small>{currentItem.title.length} / 80</small>
        </div>
        <div className={styles.editorField}>
          <label htmlFor="import-memory-place">Place</label>
          <input
            id="import-memory-place"
            value={currentItem.placeLabel}
            maxLength={120}
            placeholder="City, state, country, or landmark"
            autoComplete="off"
            autoCapitalize="words"
            disabled={locked}
            onChange={(event) =>
              updateItem(currentItem.clientItemId, {
                placeLabel: event.target.value,
                placeLabelEdited: true,
              })
            }
          />
          <small className={styles.fieldConfidence}>
            <MapPinIcon aria-hidden="true" /> {getImportStatusCopy(currentItem)}
            <button
              type="button"
              disabled={locked}
              onClick={() => onEditLocation(currentItem.clientItemId)}
            >
              Review pin
            </button>
          </small>
        </div>
        <div
          className={styles.editorField}
          data-needs-confirmation={
            needsFileDateConfirmation(currentItem) ? 'true' : undefined
          }
        >
          <label htmlFor="import-memory-date">Date visited</label>
          <input
            id="import-memory-date"
            type="date"
            value={currentItem.visitedOn}
            aria-describedby="import-memory-date-guidance"
            disabled={locked}
            onChange={(event) =>
              updateItem(currentItem.clientItemId, {
                visitedOn: event.target.value,
                captureDateSource: event.target.value ? 'manual' : 'missing',
                fileDateConfirmed: true,
              })
            }
          />
          <small
            id="import-memory-date-guidance"
            className={
              currentItem.captureDateSource === 'file_date'
                ? styles.dateConfirmation
                : undefined
            }
          >
            {currentItem.captureDateSource === 'file_date' ? (
              <>
                <CalendarDaysIcon aria-hidden="true" />
                <span>
                  {currentItem.fileDateConfirmed
                    ? 'File date · confirmed by you'
                    : 'File date only · confirm before continuing'}
                </span>
                {!currentItem.fileDateConfirmed ? (
                  <button
                    id="confirm-import-memory-date"
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      updateItem(currentItem.clientItemId, {
                        fileDateConfirmed: true,
                      })
                    }
                  >
                    Use this date
                  </button>
                ) : null}
              </>
            ) : currentItem.captureDateSource === 'photo_metadata' ? (
              'Captured date from photo'
            ) : currentItem.captureDateSource === 'manual' ? (
              'Date confirmed by you'
            ) : (
              'Optional'
            )}
          </small>
        </div>
        <div className={styles.editorField}>
          <label htmlFor="import-memory-note">
            Field note <em>Optional</em>
          </label>
          <textarea
            id="import-memory-note"
            value={currentItem.description}
            maxLength={1200}
            rows={6}
            disabled={locked}
            placeholder="The small detail you do not want to forget…"
            onChange={(event) =>
              updateItem(currentItem.clientItemId, {
                description: event.target.value,
              })
            }
          />
          <small>{currentItem.description.length} / 1200</small>
        </div>
      </section>
      <aside className={styles.storyRail} aria-label="Journey memories">
        <p className="section-kicker">Journey outline</p>
        <ol>
          {items.map((item, index) => (
            <li
              key={item.clientItemId}
              data-active={index === storyIndex ? 'true' : undefined}
            >
              <button
                type="button"
                onClick={() => onStoryIndex(index)}
                disabled={locked}
              >
                <span>
                  {item.title.trim() && item.placeLabel.trim() ? (
                    <CheckCircleIcon aria-hidden="true" />
                  ) : (
                    String(index + 1).padStart(2, '0')
                  )}
                </span>
                <span>
                  <strong>
                    {item.title || item.placeLabel || 'Untitled memory'}
                  </strong>
                  <small>{formatImportDate(item.visitedOn)}</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <footer className={styles.actionBar}>
        <button type="button" onClick={onBack} disabled={locked}>
          <ArrowLeftIcon aria-hidden="true" />{' '}
          {storyIndex ? 'Previous memory' : 'Review journey'}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={onContinue}
          disabled={busy}
        >
          {storyIndex < items.length - 1
            ? 'Next memory'
            : includeChapter
              ? 'Shape the chapter'
              : 'Create memory'}
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}
