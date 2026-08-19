import type { Metadata } from 'next';

import { getLatestOpenAtlasImportBatchData } from '@/app/lib/atlas/import-data';
import { PhotoImportWorkspace } from '@/components/atlas/photo-import-workspace';

export const metadata: Metadata = {
  title: 'Import photos — Field Atlas',
  description:
    'Turn the places and dates kept in your photographs into private Atlas memories.',
};

export default async function AtlasPhotoImportPage() {
  const openBatch = await getLatestOpenAtlasImportBatchData();
  return <PhotoImportWorkspace recoveredBatch={openBatch} />;
}
