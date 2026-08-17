'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

export function OwnerActionButton({
  children,
  accessibleLabel,
  confirmMessage,
  confirmTitle,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  accessibleLabel: string;
  confirmMessage: string;
  confirmTitle: string;
  tone?: 'quiet' | 'strong' | 'warning';
}) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function confirm() {
    const form = triggerRef.current?.form;
    setOpen(false);
    form?.requestSubmit();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`owner-user-action owner-user-action-${tone}`}
        type="button"
        disabled={pending}
        aria-label={accessibleLabel}
        onClick={() => setOpen(true)}
      >
        {pending ? 'Working…' : children}
      </button>

      <Dialog open={open} onClose={setOpen} className="owner-confirm-dialog">
        <DialogBackdrop className="owner-confirm-backdrop" transition />
        <div className="owner-confirm-positioner">
          <DialogPanel className="owner-confirm-panel" transition>
            <span className="owner-confirm-icon" aria-hidden="true">
              <ExclamationTriangleIcon />
            </span>
            <p className="section-kicker">Confirm account action</p>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmMessage}</DialogDescription>
            <div className="owner-confirm-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Keep account as is
              </button>
              <button type="button" data-tone={tone} onClick={confirm}>
                Confirm action
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
