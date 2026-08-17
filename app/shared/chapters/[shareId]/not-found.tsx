import { StatusPage } from '@/components/clean/status-page';

export default function SharedChapterUnavailable() {
  return (
    <StatusPage
      eyebrow="Chapter unavailable"
      title="This story is no longer on the map."
      description="The chapter may be private, its sharing link may have been revoked, or the address may be incomplete. We keep those possibilities indistinguishable to protect the author’s privacy."
      primaryHref="/"
      primaryLabel="Explore Field Atlas"
      secondaryHref="/login"
      secondaryLabel="Sign in"
    />
  );
}
