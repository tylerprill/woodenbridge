import { DashboardRouteLoading } from '@/components/clean/dashboard-route-loading';

export default function ChaptersLoading() {
  return (
    <DashboardRouteLoading
      eyebrow="My Chapters"
      title="Opening your stories…"
      cards={4}
    />
  );
}
