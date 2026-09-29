'use client';

import {
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  archiveAtlasEntryAction,
  archiveAtlasEntryFromKeepsakeAction,
} from '@/app/lib/actions/atlas';
import styles from './memory-actions.module.css';

type MemoryActionGroupValue = {
  activeEntryId: string | null;
  close: (entryId: string) => void;
  open: (entryId: string) => void;
};

const MemoryActionGroupContext = createContext<MemoryActionGroupValue | null>(
  null,
);

export function MemoryActionGroup({ children }: { children: ReactNode }) {
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const value: MemoryActionGroupValue = {
    activeEntryId,
    close(entryId) {
      setActiveEntryId((current) => (current === entryId ? null : current));
    },
    open: setActiveEntryId,
  };

  return (
    <MemoryActionGroupContext.Provider value={value}>
      {children}
    </MemoryActionGroupContext.Provider>
  );
}

type MemoryActionsProps = {
  entryId: string;
  title: string;
  variant: 'card' | 'detail';
  returnTo?: string;
};

export function MemoryActions({
  entryId,
  title,
  variant,
  returnTo,
}: MemoryActionsProps) {
  const router = useRouter();
  const actionGroup = useContext(MemoryActionGroupContext);
  const promptId = useId();
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [standaloneConfirming, setStandaloneConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState('');
  const memoryName = title.trim() || 'Untitled memory';
  const editHref = `/dashboard?memory=${encodeURIComponent(entryId)}`;
  const confirming = actionGroup
    ? actionGroup.activeEntryId === entryId
    : standaloneConfirming;

  const openConfirmation = useCallback(() => {
    setError('');
    if (actionGroup) {
      actionGroup.open(entryId);
      return;
    }
    setStandaloneConfirming(true);
  }, [actionGroup, entryId]);

  const dismissConfirmation = useCallback(() => {
    if (pending) return;
    if (actionGroup) {
      actionGroup.close(entryId);
    } else {
      setStandaloneConfirming(false);
    }
    setError('');
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }, [actionGroup, entryId, pending]);

  useEffect(() => {
    if (!confirming || pending) return;

    cancelRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismissConfirmation();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [confirming, dismissConfirmation, pending]);

  async function deleteMemory() {
    if (pending) return;
    setPending(true);
    setError('');

    try {
      if (variant === 'detail') {
        const result = await archiveAtlasEntryFromKeepsakeAction(entryId);
        setError(result.message);
        setPending(false);
        return;
      }

      const result = await archiveAtlasEntryAction(entryId);
      if (!result.ok) {
        setError(result.message);
        setPending(false);
        return;
      }

      if (returnTo) {
        router.replace(returnTo);
        return;
      }

      // The action revalidates the collection in the same response. This live
      // status covers the brief handoff before that server tree is committed.
      setDeleted(true);
    } catch (deleteError) {
      console.error('Memory deletion failed:', deleteError);
      setError('The memory could not be deleted. Refresh and try again.');
      setPending(false);
    }
  }

  if (deleted) {
    return (
      <p className={styles.deletedStatus} role="status">
        {memoryName} deleted.
      </p>
    );
  }

  const confirmation = (
    <div
      className={
        variant === 'card' ? styles.cardConfirmation : styles.detailConfirmation
      }
      role="alertdialog"
      aria-labelledby={`${promptId}-title`}
      aria-describedby={`${promptId}-description`}
      aria-modal="false"
      aria-busy={pending}
    >
      <div className={styles.confirmationCopy}>
        <strong id={`${promptId}-title`}>Delete this memory?</strong>
        <p id={`${promptId}-description`}>
          It disappears from journeys, and its photos are deleted. This can’t be
          undone.
        </p>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.confirmationActions}>
        <button
          ref={cancelRef}
          type="button"
          className={styles.cancelButton}
          onClick={dismissConfirmation}
          disabled={pending}
        >
          <XMarkIcon aria-hidden="true" />
          Keep memory
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={() => void deleteMemory()}
          disabled={pending}
          aria-label={
            pending
              ? `Deleting ${memoryName}`
              : `Delete ${memoryName} permanently`
          }
        >
          <TrashIcon aria-hidden="true" />
          {pending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );

  if (variant === 'detail') {
    if (confirming) return confirmation;

    return (
      <>
        <Link className={styles.detailEdit} href={editHref}>
          <PencilSquareIcon aria-hidden="true" />
          Edit memory
        </Link>
        <button
          ref={deleteTriggerRef}
          type="button"
          className={styles.detailDelete}
          onClick={openConfirmation}
          aria-haspopup="dialog"
        >
          <TrashIcon aria-hidden="true" />
          Delete memory
        </button>
      </>
    );
  }

  return (
    <div
      className={styles.cardActions}
      data-memory-actions="card"
      data-confirming={confirming ? 'true' : 'false'}
    >
      {confirming ? (
        confirmation
      ) : (
        <>
          <Link
            className={styles.iconAction}
            href={editHref}
            aria-label={`Edit ${memoryName}`}
            title={`Edit ${memoryName}`}
          >
            <PencilSquareIcon aria-hidden="true" />
          </Link>
          <button
            ref={deleteTriggerRef}
            type="button"
            className={`${styles.iconAction} ${styles.iconDelete}`}
            onClick={openConfirmation}
            aria-label={`Delete ${memoryName}`}
            aria-haspopup="dialog"
            title={`Delete ${memoryName}`}
          >
            <TrashIcon aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
