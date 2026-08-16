'use client';

import { PrinterIcon } from '@heroicons/react/24/outline';

export function PrintCardButton() {
  return (
    <button
      type="button"
      className="keepsake-print-button"
      onClick={() => window.print()}
    >
      <PrinterIcon aria-hidden="true" />
      Print or save
    </button>
  );
}
