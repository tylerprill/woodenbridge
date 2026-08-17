import { DashboardRouteLoading } from '@/components/clean/dashboard-route-loading';

export default function UsersLoading() {
  return (
    <DashboardRouteLoading
      eyebrow="Management tools"
      title="Opening the directory…"
      cards={4}
      compact
    />
  );
}
