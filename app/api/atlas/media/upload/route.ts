import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { sql } from '@vercel/postgres';

import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  ATLAS_MEDIA_ALLOWED_TYPES,
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_MEDIA_MAX_FILES,
  atlasMediaClientPayloadSchema,
  isAtlasMediaPath,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      body,
      request,
      token: getAtlasBlobToken(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: unknown;
        try {
          payload = clientPayload ? JSON.parse(clientPayload) : null;
        } catch {
          throw new Error('Invalid upload request.');
        }

        const parsed = atlasMediaClientPayloadSchema.safeParse(payload);
        if (
          !parsed.success ||
          !isAtlasMediaPath(pathname, parsed.data.entryId)
        ) {
          throw new Error('Invalid upload request.');
        }

        const ownership = await sql<{ media_count: number | string }>`
          SELECT COUNT(media.id)::int AS media_count
          FROM atlas_entries AS entry
          LEFT JOIN atlas_media AS media ON media.entry_id = entry.id
          WHERE entry.id = ${parsed.data.entryId}
            AND entry.user_id = ${session.user.id}
            AND entry.deleted_at IS NULL
          GROUP BY entry.id
          LIMIT 1
        `;

        const row = ownership.rows[0];
        if (!row || Number(row.media_count) >= ATLAS_MEDIA_MAX_FILES) {
          throw new Error('This memory cannot accept another photo.');
        }

        return {
          allowedContentTypes: [...ATLAS_MEDIA_ALLOWED_TYPES],
          maximumSizeInBytes: ATLAS_MEDIA_MAX_BYTES,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            entryId: parsed.data.entryId,
          }),
        };
      },
    });

    return Response.json(response);
  } catch (error) {
    console.error('Atlas media upload authorization failed:', error);
    return Response.json(
      { error: 'The photo upload could not be authorized.' },
      { status: 400 },
    );
  }
}
