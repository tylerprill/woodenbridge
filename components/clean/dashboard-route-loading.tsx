type DashboardRouteLoadingProps = {
  eyebrow: string;
  title: string;
  cards?: number;
  compact?: boolean;
};

export function DashboardRouteLoading({
  eyebrow,
  title,
  cards = 6,
  compact = false,
}: DashboardRouteLoadingProps) {
  return (
    <div
      className="dashboard-page dashboard-route-loading"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{title}</span>
      <header className="dashboard-route-loading-heading" aria-hidden="true">
        <div>
          <p className="section-kicker">{eyebrow}</p>
          <span className="dashboard-route-loading-title" />
          <span className="dashboard-route-loading-copy" />
        </div>
        <span className="dashboard-route-loading-badge" />
      </header>
      <div
        className="dashboard-route-loading-grid"
        data-compact={compact ? 'true' : undefined}
        aria-hidden="true"
      >
        {Array.from({ length: cards }, (_, index) => (
          <article key={index}>
            <span />
            <div>
              <i />
              <i />
              <i />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
