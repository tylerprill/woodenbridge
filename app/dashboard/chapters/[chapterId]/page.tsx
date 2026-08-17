import { notFound } from 'next/navigation';

import { getAtlasChapter } from '@/app/lib/chapters/data';
import { ChapterReader } from '@/components/chapters/chapter-reader';

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const chapter = await getAtlasChapter(chapterId);
  if (!chapter) notFound();

  return <ChapterReader chapter={chapter} mode="owner" />;
}
