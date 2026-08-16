import { getAtlasChapterEditorData } from '@/app/lib/chapters/data';
import { ChapterEditor } from '@/components/chapters/chapter-editor';

export default async function NewChapterPage() {
  const data = await getAtlasChapterEditorData();
  return (
    <ChapterEditor chapter={null} availableEntries={data.availableEntries} />
  );
}
