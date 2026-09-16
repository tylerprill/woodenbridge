import { DayShell } from '@/components/rediscovery/day-shell';
import styles from '@/components/rediscovery/day-controls.module.css';

export default function OnThisDayLoading() {
  return (
    <DayShell>
      <div className={styles.status} role="status" aria-live="polite">
        Bringing your memories back into view…
      </div>
    </DayShell>
  );
}
