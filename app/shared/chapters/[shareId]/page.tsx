import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { getSharedAtlasChapter } from '@/app/lib/chapters/data';
import { SITE_NAME, SITE_URL, SOCIAL_IMAGE } from '@/app/lib/site-config';
import { ChapterReader } from '@/components/chapters/chapter-reader';

export const dynamic = 'force-dynamic';

const getSharedChapter = cache(getSharedAtlasChapter);

function chapterDescription(introduction: string, memoryCount: number) {
  const fallback = `A Field Atlas chapter with ${memoryCount} memories.`;
  const description = introduction.trim() || fallback;

  if (description.length <= 180) return description;

  const shortened = description.slice(0, 177);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, Math.max(lastSpace, 140)).trimEnd()}…`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  const chapter = await getSharedChapter(shareId);
  if (!chapter) return { title: 'Shared chapter | Field Atlas' };

  const description = chapterDescription(
    chapter.introduction,
    chapter.memoryCount,
  );
  const chapterUrl = new URL(`/shared/chapters/${shareId}`, SITE_URL);
  const socialImage = chapter.coverMedia
    ? {
        url: new URL(chapter.coverMedia.thumbnailUrl, SITE_URL),
        alt: chapter.coverMedia.altText || `${chapter.title} cover photograph`,
      }
    : SOCIAL_IMAGE;

  return {
    title: `${chapter.title} | Field Atlas`,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      type: 'article',
      url: chapterUrl,
      title: chapter.title,
      description,
      siteName: SITE_NAME,
      images: [socialImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: chapter.title,
      description,
      images: [socialImage],
    },
  };
}

export default async function SharedChapterPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const chapter = await getSharedChapter(shareId);
  if (!chapter) notFound();

  return (
    <main className="shared-chapter-page">
      <ChapterReader chapter={chapter} mode="shared" />
    </main>
  );
}
