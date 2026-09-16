import type { ReactNode } from 'react';

import styles from './day-controls.module.css';

export function DayShell({ children }: { children: ReactNode }) {
  return (
    <div className={`dashboard-page ${styles.shell}`}>
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Return to a memory</p>
          <h1>On this day</h1>
          <p>
            A familiar place. A different year. A little of your world, again.
          </p>
        </div>
      </header>
      {children}
    </div>
  );
}
