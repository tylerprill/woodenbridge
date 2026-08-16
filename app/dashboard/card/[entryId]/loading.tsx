export default function KeepsakeLoading() {
  return (
    <div className="dashboard-page keepsake-page">
      <div className="keepsake-page-loading" role="status" aria-live="polite">
        <span aria-hidden="true" />
        <div>
          <p className="section-kicker">Opening keepsake</p>
          <h1>Bringing the memory back…</h1>
        </div>
      </div>
    </div>
  );
}
