'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useMemo, useState } from 'react';
import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import AtlasMap from './atlas-map-loader';
import {
  formatImportDate,
  getImportStatusCopy,
  needsFileDateConfirmation,
} from './photo-import-helpers';
import type { ImportItem } from './photo-import-types';
import { ImportPhotoPreview } from './photo-import-ui';
import styles from './photo-import.module.css';

export function PhotoImportReviewStep({
  items,
  activeCount,
  mapEntries,
  initialView,
  confidentGpsCount,
  unresolvedCount,
  locatingCount,
  processing,
  blockingCount,
  mapSuspended,
  onEditLocation,
  onRemove,
  onRemoveMany,
  onConfirmFileDates,
  onBack,
  onContinue,
}: {
  items: ImportItem[];
  activeCount: number;
  mapEntries: AtlasEntry[];
  initialView: AtlasView;
  confidentGpsCount: number;
  unresolvedCount: number;
  locatingCount: number;
  processing: boolean;
  blockingCount: number;
  mapSuspended: boolean;
  onEditLocation: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveMany: (ids: string[]) => void;
  onConfirmFileDates: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [attentionOnly, setAttentionOnly] = useState(false);
  const attentionItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.state === 'duplicate' ||
          item.state === 'error' ||
          item.latitude === null ||
          item.longitude === null ||
          needsFileDateConfirmation(item),
      ),
    [items],
  );
  const visibleItems = attentionOnly ? attentionItems : items;
  const removableIds = items
    .filter((item) => item.state === 'duplicate' || item.state === 'error')
    .map((item) => item.clientItemId);
  const fileDateCount = items.filter(needsFileDateConfirmation).length;
  const continueLabel = processing
    ? 'Finishing photo review…'
    : locatingCount
      ? `Finding ${locatingCount} ${locatingCount === 1 ? 'place' : 'places'}…`
      : blockingCount
        ? `Remove ${blockingCount} unreadable ${blockingCount === 1 ? 'photo' : 'photos'}`
        : unresolvedCount
          ? `Review ${unresolvedCount} ${unresolvedCount === 1 ? 'place' : 'places'}`
          : 'Add optional details';
  const compactContinueLabel = processing
    ? 'Finishing…'
    : locatingCount
      ? `Finding ${locatingCount}`
      : blockingCount
        ? `Remove ${blockingCount} ${blockingCount === 1 ? 'file' : 'files'}`
        : unresolvedCount
          ? `Review ${unresolvedCount}`
          : 'Details';

  return (
    <main className={styles.reviewLayout}>
      <section
        className={styles.reviewList}
        aria-labelledby="review-list-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className="section-kicker">Recognized from your photographs</p>
            <h2 id="review-list-title">
              {activeCount} {activeCount === 1 ? 'memory' : 'memories'} across
              the map.
            </h2>
          </div>
          <div className={styles.reviewSummary}>
            <span>
              <strong>{confidentGpsCount}</strong> confident GPS
            </span>
            <span data-warning={unresolvedCount ? 'true' : undefined}>
              <strong>{unresolvedCount}</strong> need a place
            </span>
          </div>
        </div>
        <div className={styles.reviewToolbar}>
          <div
            className={styles.reviewFilters}
            role="group"
            aria-label="Filter photo review"
          >
            <button
              type="button"
              aria-pressed={!attentionOnly}
              data-active={!attentionOnly ? 'true' : undefined}
              onClick={() => setAttentionOnly(false)}
            >
              All {items.length}
            </button>
            <button
              type="button"
              aria-pressed={attentionOnly}
              data-active={attentionOnly ? 'true' : undefined}
              onClick={() => setAttentionOnly(true)}
            >
              Needs attention {attentionItems.length}
            </button>
          </div>
          <div className={styles.reviewBulkActions}>
            {fileDateCount ? (
              <button type="button" onClick={onConfirmFileDates}>
                <CheckCircleIcon aria-hidden="true" /> Confirm {fileDateCount}{' '}
                file {fileDateCount === 1 ? 'date' : 'dates'}
              </button>
            ) : null}
            {removableIds.length ? (
              <button type="button" onClick={() => onRemoveMany(removableIds)}>
                <TrashIcon aria-hidden="true" /> Remove {removableIds.length}{' '}
                unusable
              </button>
            ) : null}
          </div>
        </div>
        {visibleItems.length ? (
          <ol className={styles.reviewCards}>
            {visibleItems.map((item) => (
              <li key={item.clientItemId} data-state={item.state}>
                <figure>
                  <ImportPhotoPreview item={item} />
                </figure>
                <div className={styles.reviewCardCopy}>
                  <small>
                    Memory {String(items.indexOf(item) + 1).padStart(2, '0')}
                  </small>
                  <h3>{item.placeLabel || 'Place needs review'}</h3>
                  <p>
                    <CalendarDaysIcon aria-hidden="true" />{' '}
                    {formatImportDate(item.visitedOn)}
                  </p>
                  <span data-status={item.state}>
                    {item.state === 'ready' ? (
                      <CheckCircleIcon aria-hidden="true" />
                    ) : (
                      <ExclamationTriangleIcon aria-hidden="true" />
                    )}
                    {getImportStatusCopy(item)}
                  </span>
                  {item.error ? <em>{item.error}</em> : null}
                </div>
                <div className={styles.reviewCardActions}>
                  {item.state !== 'duplicate' && item.state !== 'error' ? (
                    <button
                      type="button"
                      onClick={() => onEditLocation(item.clientItemId)}
                    >
                      <MapPinIcon aria-hidden="true" />
                      {item.latitude === null ? 'Choose place' : 'Review pin'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onRemove(item.clientItemId)}
                    aria-label={`Remove ${item.fileName}`}
                  >
                    <TrashIcon aria-hidden="true" /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.reviewClear} role="status">
            <CheckCircleIcon aria-hidden="true" />
            <p>
              <strong>Everything is ready.</strong>
              No photos need attention.
            </p>
          </div>
        )}
      </section>

      <aside className={styles.journeyMap} aria-label="Detected journey map">
        {mapSuspended ? null : (
          <AtlasMap
            entries={mapEntries}
            initialView={initialView}
            interactionLocked={false}
            selectedId={null}
            placementMode={false}
            focusRequest={{ id: null, nonce: 0 }}
            fitRequest={1}
            onSelect={onEditLocation}
            onPlace={() => undefined}
            onViewChange={() => undefined}
          />
        )}
        <div className={styles.mapLegend}>
          <MapPinIcon aria-hidden="true" />
          <span>
            <strong>{mapEntries.length} pins recognized</strong>
            Select a memory to inspect its exact place.
          </span>
        </div>
      </aside>
      <footer className={styles.actionBar}>
        <button
          type="button"
          aria-label="Add or remove photos"
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className={styles.longActionLabel}>Add or remove photos</span>
          <span className={styles.shortActionLabel}>Photos</span>
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          aria-label={continueLabel}
          disabled={Boolean(
            processing || unresolvedCount || locatingCount || blockingCount,
          )}
          onClick={onContinue}
        >
          <span className={styles.longActionLabel}>{continueLabel}</span>
          <span className={styles.shortActionLabel}>
            {compactContinueLabel}
          </span>
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}
