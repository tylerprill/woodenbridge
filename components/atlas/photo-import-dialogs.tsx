'use client';

import { MapPinIcon, PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import AtlasMap from './atlas-map-loader';
import { toImportMapEntry } from './photo-import-helpers';
import {
  IMPORT_DEFAULT_VIEW,
  type ConfirmImportLocation,
  type ImportItem,
} from './photo-import-types';
import styles from './photo-import.module.css';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function ImportDialogShell({
  children,
  labelId,
  role = 'dialog',
  onClose,
}: {
  children: ReactNode;
  labelId: string;
  role?: 'dialog' | 'alertdialog';
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (returnFocusRef.current instanceof HTMLElement) {
        returnFocusRef.current.focus();
      }
    };
  }, []);

  return (
    <div className={styles.locationBackdrop} role="presentation">
      <section
        ref={dialogRef}
        className={
          role === 'alertdialog' ? styles.leaveDialog : styles.locationDialog
        }
        role={role}
        aria-modal="true"
        aria-labelledby={labelId}
      >
        {children}
      </section>
    </div>
  );
}

export function ImportLocationDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: ImportItem;
  onClose: () => void;
  onConfirm: ConfirmImportLocation;
}) {
  const entry = toImportMapEntry(item, 0);
  const initialView =
    item.latitude !== null && item.longitude !== null
      ? {
          latitude: item.latitude,
          longitude: item.longitude,
          zoom: 8,
          bearing: 0,
          pitch: 0,
        }
      : IMPORT_DEFAULT_VIEW;
  const [mapCenter, setMapCenter] = useState({
    latitude: initialView.latitude,
    longitude: initialView.longitude,
  });
  return (
    <ImportDialogShell labelId="location-dialog-title" onClose={onClose}>
      <header>
        <div>
          <p className="section-kicker">Review the exact pin</p>
          <h2 id="location-dialog-title">
            {item.placeLabel || 'Choose where this belongs.'}
          </h2>
          <p>
            Move the map with a pointer or arrow keys, then choose its center.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close location editor"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>
      <div className={styles.locationMap}>
        <AtlasMap
          key={item.clientItemId}
          entries={entry ? [entry] : []}
          initialView={initialView}
          interactionLocked={false}
          selectedId={null}
          placementMode
          focusRequest={{ id: null, nonce: 0 }}
          fitRequest={0}
          onSelect={() => undefined}
          onPlace={(coordinates) => void onConfirm(item, coordinates)}
          onViewChange={(view) =>
            setMapCenter({
              latitude: view.latitude,
              longitude: view.longitude,
            })
          }
        />
        <div className={styles.locationControls}>
          <p>
            <MapPinIcon aria-hidden="true" /> The crosshair marks the selected
            center.
          </p>
          <button
            type="button"
            onClick={() => void onConfirm(item, mapCenter)}
            disabled={item.state === 'locating'}
          >
            <MapPinIcon aria-hidden="true" />
            {item.state === 'locating'
              ? 'Finding this place…'
              : 'Use map center'}
          </button>
        </div>
      </div>
    </ImportDialogShell>
  );
}

export function ImportLeaveDialog({
  hasDraft,
  armed,
  busy,
  onKeepWorking,
  onArmOrDiscard,
}: {
  hasDraft: boolean;
  armed: boolean;
  busy: boolean;
  onKeepWorking: () => void;
  onArmOrDiscard: () => void;
}) {
  return (
    <ImportDialogShell
      labelId="leave-dialog-title"
      role="alertdialog"
      onClose={onKeepWorking}
    >
      <span className={styles.dialogIcon}>
        <PhotoIcon aria-hidden="true" />
      </span>
      <p className="section-kicker">Leave this photo journey?</p>
      <h2 id="leave-dialog-title">Your unfinished review will close.</h2>
      <p>
        {hasDraft
          ? 'Field Atlas will also clear the private import draft and any prepared uploads.'
          : 'No memories have been created yet.'}
      </p>
      <div>
        <button type="button" onClick={onKeepWorking} disabled={busy}>
          Keep working
        </button>
        <button
          type="button"
          data-armed={armed ? 'true' : undefined}
          onClick={onArmOrDiscard}
          disabled={busy}
        >
          {busy
            ? 'Clearing draft…'
            : armed
              ? 'Confirm discard'
              : 'Discard import'}
        </button>
      </div>
    </ImportDialogShell>
  );
}
