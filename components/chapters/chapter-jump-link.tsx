'use client';

import { ArrowDownIcon } from '@heroicons/react/24/outline';
import type { MouseEvent } from 'react';

export function ChapterJumpLink({
  className,
  href,
  label,
}: {
  className: string;
  href: `#${string}`;
  label: string;
}) {
  function focusDestination(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    window.setTimeout(() => {
      const destination = document.getElementById(href.slice(1));
      const focusTarget = destination?.querySelector<HTMLElement>(
        '[data-chapter-focus-target]',
      );
      (focusTarget ?? destination)?.focus({ preventScroll: true });
    }, 0);
  }

  return (
    <a className={className} href={href} onClick={focusDestination}>
      {label}
      <ArrowDownIcon aria-hidden="true" />
    </a>
  );
}
