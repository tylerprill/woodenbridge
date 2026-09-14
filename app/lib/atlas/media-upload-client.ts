'use client';

import { upload } from '@vercel/blob/client';

type AtlasMediaUploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
};

export type AtlasMediaUploadOptions = {
  clientPayload: string;
  multipart: boolean;
  onUploadProgress?: (progress: AtlasMediaUploadProgress) => void;
};

export type AtlasMediaUploadResult = {
  pathname: string;
};

function encodeClientPayload(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function uploadToE2EFilesystem(
  pathname: string,
  body: Blob,
  options: AtlasMediaUploadOptions,
): Promise<AtlasMediaUploadResult> {
  options.onUploadProgress?.({ loaded: 0, total: body.size, percentage: 0 });
  const response = await fetch(
    `/api/atlas/media/upload?pathname=${encodeURIComponent(pathname)}`,
    {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': body.type,
        'X-Atlas-Upload-Payload': encodeClientPayload(options.clientPayload),
      },
      body,
    },
  );
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new Error(
      typeof result?.error === 'string'
        ? result.error
        : 'The photo upload could not be completed.',
    );
  }

  const result = (await response.json()) as { pathname?: unknown };
  if (result.pathname !== pathname) {
    throw new Error('The photo upload returned an invalid path.');
  }
  options.onUploadProgress?.({
    loaded: body.size,
    total: body.size,
    percentage: 100,
  });
  return { pathname };
}

export function uploadAtlasMedia(
  pathname: string,
  body: Blob,
  options: AtlasMediaUploadOptions,
): Promise<AtlasMediaUploadResult> {
  if (process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER === 'filesystem') {
    return uploadToE2EFilesystem(pathname, body, options);
  }

  return upload(pathname, body, {
    access: 'private',
    handleUploadUrl: '/api/atlas/media/upload',
    ...options,
  });
}
