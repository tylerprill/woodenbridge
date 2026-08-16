'use client';

import { useFormStatus } from 'react-dom';

export function OwnerActionButton({
  children,
  confirmMessage,
  tone = 'quiet',
}: {
  children: React.ReactNode;
  confirmMessage: string;
  tone?: 'quiet' | 'strong';
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`owner-user-action owner-user-action-${tone}`}
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
