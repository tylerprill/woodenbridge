import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getSharedAtlasChapter } from '@/app/lib/chapters/data';
import { ChapterReader } from '@/components/chapters/chapter-reader';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const chapter = await getSharedAtlasChapter(shareId);
  if (!chapter) return { title: 'Shared chapter | Field Atlas' };

  return {
    title: `${chapter.title} | Field Atlas`,
    description:
      chapter.introduction ||
      `A Field Atlas chapter with ${chapter.memoryCount} memories.`,
    robots: { index: false, follow: false },
  };
}

export default async function SharedChapterPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const chapter = await getSharedAtlasChapter(shareId);
  if (!chapter) notFound();

  return (
    <main className="shared-chapter-page">
      <ChapterReader chapter={chapter} mode="shared" />
    </main>
  );
}
