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
import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import AtlasMap from './atlas-map-loader';
import { formatImportDate, getImportStatusCopy } from './photo-import-helpers';
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
  onEditLocation,
  onRemove,
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
  onEditLocation: (id: string) => void;
  onRemove: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
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
        <ol className={styles.reviewCards}>
          {items.map((item, index) => (
            <li key={item.clientItemId} data-state={item.state}>
              <figure>
                <ImportPhotoPreview item={item} />
              </figure>
              <div className={styles.reviewCardCopy}>
                <small>Memory {String(index + 1).padStart(2, '0')}</small>
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
      </section>

      <aside className={styles.journeyMap} aria-label="Detected journey map">
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
        <div className={styles.mapLegend}>
          <MapPinIcon aria-hidden="true" />
          <span>
            <strong>{mapEntries.length} pins recognized</strong>
            Select a memory to inspect its exact place.
          </span>
        </div>
      </aside>
      <footer className={styles.actionBar}>
        <button type="button" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" /> Add or remove photos
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={Boolean(
            processing || unresolvedCount || locatingCount || blockingCount,
          )}
          onClick={onContinue}
        >
          {processing
            ? 'Finishing photo review…'
            : locatingCount
              ? `Finding ${locatingCount} ${locatingCount === 1 ? 'place' : 'places'}…`
              : blockingCount
                ? `Remove ${blockingCount} unreadable ${blockingCount === 1 ? 'photo' : 'photos'}`
                : unresolvedCount
                  ? `Review ${unresolvedCount} ${unresolvedCount === 1 ? 'place' : 'places'}`
                  : 'Tell the stories'}
          <ArrowRightIcon aria-hidden="true" />
        </button>
      </footer>
    </main>
  );
}
