import { DashboardRouteLoading } from '@/components/clean/dashboard-route-loading';

export default function AtlasPhotoImportLoading() {
  return (
    <DashboardRouteLoading
      eyebrow="Photo journey"
      title="Opening the photo workshop…"
      cards={4}
      compact
    />
  );
}
