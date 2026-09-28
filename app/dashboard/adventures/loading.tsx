import { DashboardRouteLoading } from '@/components/clean/dashboard-route-loading';

export default function AdventuresLoading() {
  return (
    <DashboardRouteLoading
      eyebrow="Adventures"
      title="Opening your trips…"
      cards={3}
    />
  );
}
