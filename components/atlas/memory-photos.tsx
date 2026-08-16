'use client';

import {
  ArrowUpTrayIcon,
  PhotoIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { upload } from '@vercel/blob/client';
import Image from 'next/image';
import { useRef, useState } from 'react';

import {
  deleteAtlasMediaAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import type { AtlasMedia } from '@/app/lib/atlas/definitions';
import {
  ATLAS_MEDIA_ALLOWED_TYPES,
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_MEDIA_MAX_FILES,
  createAtlasMediaPath,
  isAllowedAtlasMediaType,
} from '@/app/lib/atlas/media-policy';
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

async function readImageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

function fileError(file: File) {
  if (!isAllowedAtlasMediaType(file.type)) {
    return 'Choose a JPG, PNG, or WebP image.';
  }
  if (!file.size || file.size > ATLAS_MEDIA_MAX_BYTES) {
    return 'Choose an image smaller than 10 MB.';
  }
  return null;
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
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);

  const uploadPhotos = async (files: File[]) => {
    const availableSlots = ATLAS_MEDIA_MAX_FILES - media.length;
    if (files.length > availableSlots) {
      setMessage(
        `This memory has room for ${availableSlots} more ${availableSlots === 1 ? 'photo' : 'photos'}.`,
      );
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const invalidFile = files.find((file) => fileError(file));
    if (invalidFile) {
      setMessage(`${invalidFile.name}: ${fileError(invalidFile)}`);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    setProgress(0);
    setMessage('');

    try {
      let nextMedia = [...media];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const dimensions = await readImageDimensions(file);
        const pathname = createAtlasMediaPath(
          entryId,
          crypto.randomUUID(),
          file.type as (typeof ATLAS_MEDIA_ALLOWED_TYPES)[number],
        );
        const blob = await upload(pathname, file, {
          access: 'private',
          handleUploadUrl: '/api/atlas/media/upload',
          clientPayload: JSON.stringify({ entryId }),
          multipart: true,
          onUploadProgress: ({ percentage }) =>
            setProgress(
              Math.round(((index + percentage / 100) / files.length) * 100),
            ),
        });
        const result = await registerAtlasMediaAction({
          entryId,
          pathname: blob.pathname,
          width: dimensions.width,
          height: dimensions.height,
          altText: title.trim() || placeLabel.trim() || placeName?.trim() || '',
        });

        if (!result.ok) {
          setMessage(
            `${index ? `${index} ${index === 1 ? 'photo was' : 'photos were'} added. ` : ''}${result.message}`,
          );
          return;
        }

        nextMedia = [...nextMedia, result.data];
        onChange(nextMedia);
      }

      setProgress(100);
    } catch (error) {
      console.error('Atlas photo upload failed:', error);
      setMessage('The photo could not be uploaded. Please try again.');
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
    const result = await deleteAtlasMediaAction(photo.id);
    if (!result.ok) {
      setMessage(result.message);
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
                : 'Add the image that brings this place back.'}
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
                : 'Add photos'}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ATLAS_MEDIA_ALLOWED_TYPES.join(',')}
            disabled={loading || uploading || atLimit}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) void uploadPhotos(files);
            }}
          />
        </label>
      </div>

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
                src={photo.deliveryUrl}
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
        <p className={styles.photoMessage} role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
