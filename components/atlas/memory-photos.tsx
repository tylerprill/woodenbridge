'use client';

import {
  ArrowUpTrayIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import { useRef, useState } from 'react';

import {
  discardAtlasMediaUploadAction,
  deleteAtlasMediaAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import type { AtlasMedia } from '@/app/lib/atlas/definitions';
import {
  ATLAS_MEDIA_MAX_FILES,
  createAtlasMediaPath,
  createAtlasThumbnailPath,
  isAllowedAtlasMediaType,
} from '@/app/lib/atlas/media-policy';
import { uploadAtlasMedia } from '@/app/lib/atlas/media-upload-client';
import {
  analyzeAtlasImportPhoto,
  prepareAtlasImportPhoto,
} from '@/app/lib/atlas/photo-import-client';
import { getImportFileProblem } from './photo-import-helpers';
import styles from './atlas.module.css';

type MemoryPhotosProps = {
  entryId: string;
  title: string;
  placeLabel: string;
  placeName: string | null;
  media: AtlasMedia[];
  loading: boolean;
  onChange: (media: AtlasMedia[]) => void;
};

function fileError(file: File) {
  return getImportFileProblem(file);
}

export function MemoryPhotos({
  entryId,
  title,
  placeLabel,
  placeName,
  media,
  loading,
  onChange,
}: MemoryPhotosProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);

  const uploadPhotos = async (files: File[]) => {
    const availableSlots = ATLAS_MEDIA_MAX_FILES - media.length;
    if (files.length > availableSlots) {
      setMessage(
        `This memory has room for ${availableSlots} more ${availableSlots === 1 ? 'photo' : 'photos'}.`,
      );
      setMessageIsError(true);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const invalidFile = files.find((file) => fileError(file));
    if (invalidFile) {
      setMessage(`${invalidFile.name}: ${fileError(invalidFile)}`);
      setMessageIsError(true);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    setProgress(0);
    setMessage('');
    setMessageIsError(false);

    let pendingUpload: {
      mediaId: string;
      pathname: string;
      thumbnailPathname: string;
    } | null = null;

    try {
      let nextMedia = [...media];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setMessage(`Preparing photo ${index + 1} of ${files.length}…`);
        const analysis = await analyzeAtlasImportPhoto(file);
        const blockingIssue = analysis.issues.find(
          (issue) => issue.severity === 'error',
        );
        if (blockingIssue || !analysis.canPrepare) {
          throw new Error(
            blockingIssue?.message ?? 'This photograph could not be prepared.',
          );
        }
        const prepared = await prepareAtlasImportPhoto(file, {
          analysis,
          onProgress: ({ percent }) =>
            setProgress(
              Math.round(
                ((index + (percent / 100) * 0.25) / files.length) * 100,
              ),
            ),
        });
        const { master, thumbnail, dimensions } = prepared;
        if (!isAllowedAtlasMediaType(master.type)) {
          throw new Error('This photograph could not make a supported copy.');
        }
        const mediaId = crypto.randomUUID();
        const pathname = createAtlasMediaPath(entryId, mediaId, master.type);
        const thumbnailPathname = createAtlasThumbnailPath(
          entryId,
          mediaId,
          thumbnail.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
        );
        pendingUpload = { mediaId, pathname, thumbnailPathname };
        const clientPayload = JSON.stringify({
          entryId,
          mediaId,
          pathname,
          thumbnailPathname,
        });
        const operationProgress = [0, 0];
        const reportProgress = (operation: 0 | 1, percentage: number) => {
          operationProgress[operation] = percentage / 100;
          setProgress(
            Math.round(
              ((index +
                0.25 +
                ((operationProgress[0] + operationProgress[1]) / 2) * 0.75) /
                files.length) *
                100,
            ),
          );
        };
        const [blobResult, thumbnailResult] = await Promise.allSettled([
          uploadAtlasMedia(pathname, master, {
            clientPayload,
            multipart: true,
            onUploadProgress: ({ percentage }) => reportProgress(0, percentage),
          }),
          uploadAtlasMedia(thumbnailPathname, thumbnail, {
            clientPayload,
            multipart: false,
            onUploadProgress: ({ percentage }) => reportProgress(1, percentage),
          }),
        ]);
        if (blobResult.status === 'rejected') throw blobResult.reason;
        if (thumbnailResult.status === 'rejected') {
          throw thumbnailResult.reason;
        }
        const blob = blobResult.value;
        const thumbnailBlob = thumbnailResult.value;
        const result = await registerAtlasMediaAction({
          entryId,
          mediaId,
          pathname: blob.pathname,
          thumbnailPathname: thumbnailBlob.pathname,
          width: dimensions.masterWidth,
          height: dimensions.masterHeight,
          altText: title.trim() || placeLabel.trim() || placeName?.trim() || '',
        });

        if (!result.ok) {
          await discardAtlasMediaUploadAction({
            entryId,
            mediaId,
            pathname,
            thumbnailPathname,
          });
          pendingUpload = null;
          setMessage(
            `${index ? `${index} ${index === 1 ? 'photo was' : 'photos were'} added. ` : ''}${result.message}`,
          );
          setMessageIsError(true);
          return;
        }

        nextMedia = [...nextMedia, result.data];
        onChange(nextMedia);
        pendingUpload = null;
      }

      setProgress(100);
      setMessage(
        `${files.length} ${files.length === 1 ? 'photo was' : 'photos were'} added privately.`,
      );
    } catch (error) {
      console.error('Atlas photo upload failed:', error);
      if (pendingUpload) {
        await discardAtlasMediaUploadAction({ entryId, ...pendingUpload });
      }
      setMessageIsError(true);
      setMessage(
        error instanceof Error
          ? error.message
          : 'The photo could not be uploaded. Please try again.',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removePhoto = async (photo: AtlasMedia) => {
    if (removeArmed !== photo.id) {
      setRemoveArmed(photo.id);
      return;
    }

    setMessage('');
    setMessageIsError(false);
    const result = await deleteAtlasMediaAction(photo.id);
    if (!result.ok) {
      setMessage(result.message);
      setMessageIsError(true);
      setRemoveArmed(null);
      return;
    }

    onChange(media.filter((item) => item.id !== photo.id));
    setRemoveArmed(null);
  };

  const atLimit = media.length >= ATLAS_MEDIA_MAX_FILES;

  return (
    <section className={styles.photoField} aria-labelledby="memory-photo-label">
      <div className={styles.photoHeading}>
        <div>
          <span className={styles.fieldLabel} id="memory-photo-label">
            <PhotoIcon aria-hidden="true" /> Photographs
          </span>
          <p>
            {loading
              ? 'Opening the photographs kept with this place…'
              : media.length
                ? `${media.length} of ${ATLAS_MEDIA_MAX_FILES} kept with this place`
                : 'Upload the images that bring this place back.'}
          </p>
        </div>
        <label
          className={styles.photoUploadButton}
          data-disabled={loading || uploading || atLimit ? 'true' : 'false'}
        >
          <ArrowUpTrayIcon aria-hidden="true" />
          {loading
            ? 'Opening…'
            : uploading
              ? `${progress}%`
              : atLimit
                ? 'Full'
                : 'Upload photos'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            disabled={loading || uploading || atLimit}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) void uploadPhotos(files);
            }}
          />
        </label>
      </div>
      <p className={styles.photoUploadGuidance}>
        JPG, PNG, WebP, HEIC, or HEIF · Up to 25 MB each ·{' '}
        {ATLAS_MEDIA_MAX_FILES - media.length} remaining
      </p>

      {uploading ? (
        <div
          className={styles.uploadProgress}
          role="progressbar"
          aria-label="Photo upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {loading ? (
        <div className={styles.photoLoading} role="status">
          <span aria-hidden="true" />
          Opening photographs…
        </div>
      ) : media.length ? (
        <div className={styles.photoGrid}>
          {media.map((photo) => (
            <figure className={styles.photoTile} key={photo.id}>
              <Image
                src={photo.thumbnailUrl}
                alt={
                  photo.altText.trim() ||
                  title.trim() ||
                  placeLabel.trim() ||
                  placeName?.trim() ||
                  'Atlas memory'
                }
                fill
                sizes="(max-width: 768px) 40vw, 160px"
                unoptimized
              />
              <button
                type="button"
                data-armed={removeArmed === photo.id ? 'true' : 'false'}
                onClick={() => void removePhoto(photo)}
                onBlur={() => setRemoveArmed(null)}
                aria-label={
                  removeArmed === photo.id
                    ? 'Confirm remove photo'
                    : 'Remove photo'
                }
              >
                <TrashIcon aria-hidden="true" />
                <span>{removeArmed === photo.id ? 'Remove?' : 'Remove'}</span>
              </button>
            </figure>
          ))}
        </div>
      ) : null}

      {message ? (
        <p
          className={styles.photoMessage}
          data-error={messageIsError ? 'true' : undefined}
          role={messageIsError ? 'alert' : 'status'}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
