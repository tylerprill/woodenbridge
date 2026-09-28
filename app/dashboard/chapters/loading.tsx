import { DashboardRouteLoading } from '@/components/clean/dashboard-route-loading';

export default function ChaptersLoading() {
  return (
    <DashboardRouteLoading
      eyebrow="Journeys"
      title="Opening your stories…"
      cards={4}
    />
  );
}
