import { StatusPage } from '@/components/clean/status-page';

export default function NotFound() {
  return (
    <StatusPage
      eyebrow="Beyond the map"
      title="This path is not in the atlas."
      description="The page may have moved, or the address may be incomplete. Return to Field Atlas and choose another direction."
      primaryHref="/"
      primaryLabel="Return home"
    />
  );
}
