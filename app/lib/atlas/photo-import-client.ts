'use client';

import {
  ATLAS_IMPORT_THUMBNAIL_MIME_TYPE,
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_MEDIA_MAX_DIMENSION,
  ATLAS_THUMBNAIL_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_DIMENSION,
  ATLAS_THUMBNAIL_QUALITY,
} from './media-policy';
import type {
  AtlasHeicWorkerRequest,
  AtlasHeicWorkerResponse,
} from './photo-import-heic.worker';

const IMPORT_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
// A decoded RGBA photograph uses roughly four bytes per pixel before the
// derivative canvases and decoder overhead. Keeping this at 25 MP supports
// modern 24 MP camera-roll photos without asking a mobile tab to hold a
// 200+ MB 48 MP bitmap during a bulk import.
const IMPORT_MAX_PIXELS = 25_000_000;
const IMPORT_MAX_DIMENSION = ATLAS_MEDIA_MAX_DIMENSION;
const IMPORT_MASTER_MAX_DIMENSION = 2560;
const IMPORT_THUMBNAIL_MAX_DIMENSION = ATLAS_THUMBNAIL_MAX_DIMENSION;
const IMPORT_MASTER_MIME_TYPE = 'image/jpeg';
const IMPORT_THUMBNAIL_MIME_TYPE = ATLAS_IMPORT_THUMBNAIL_MIME_TYPE;
const IMPORT_MASTER_QUALITY = 0.9;
const IMPORT_THUMBNAIL_QUALITY = ATLAS_THUMBNAIL_QUALITY;
const HEIC_WORKER_TIMEOUT_MS = 90_000;
const HEIC_WORKER_IDLE_TIMEOUT_MS = 60_000;
const IMAGE_LOAD_TIMEOUT_MS = 15_000;
const HEIC_WORKER_NAME = 'field-atlas-heic-decoder';

export type AtlasImportPhotoFormat =
  'heic' | 'jpeg' | 'png' | 'webp' | 'unknown';

export type AtlasImportConfidence = 'high' | 'medium' | 'low';

export type AtlasImportPhotoIssueCode =
  | 'file-too-large'
  | 'image-too-large'
  | 'invalid-location'
  | 'metadata-unreadable'
  | 'mime-mismatch'
  | 'missing-capture-date'
  | 'missing-location'
  | 'unsupported-format'
  | 'zero-zero-location';

export type AtlasImportPhotoIssue = {
  code: AtlasImportPhotoIssueCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type AtlasImportPhotoLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  source: 'exif-gps';
  confidence: AtlasImportConfidence;
};

export type AtlasImportPhotoCapture = {
  /** The photographer's local calendar date. Use this for `visitedOn`. */
  localDate: string;
  /** Local wall-clock time without a timezone suffix, when available. */
  localDateTime: string | null;
  offset: string | null;
  /** The absolute instant is only set when the source supplied an offset. */
  instant: string | null;
  source: 'date-time-original' | 'date-time-digitized' | 'file-last-modified';
  confidence: AtlasImportConfidence;
};

export type AnalyzedImportPhoto = {
  file: File;
  name: string;
  byteSize: number;
  /** SHA-256 of the selected source bytes; null only for rejected oversized files. */
  sourceHash: string | null;
  declaredMimeType: string | null;
  format: AtlasImportPhotoFormat;
  isHeic: boolean;
  canPrepare: boolean;
  orientation: number | null;
  location: AtlasImportPhotoLocation | null;
  capture: AtlasImportPhotoCapture | null;
  issues: AtlasImportPhotoIssue[];
};

export type PreparedImportPhoto = {
  analysis: AnalyzedImportPhoto;
  master: Blob;
  thumbnail: Blob;
  dimensions: {
    sourceWidth: number;
    sourceHeight: number;
    masterWidth: number;
    masterHeight: number;
    thumbnailWidth: number;
    thumbnailHeight: number;
  };
};

export type PreparedAtlasImportPreview = {
  blob: Blob;
  width: number;
  height: number;
};

export type AtlasImportPhotoProgressStage =
  'analyzing' | 'converting-heic' | 'decoding' | 'rendering' | 'ready';

export type AtlasImportPhotoProgress = {
  stage: AtlasImportPhotoProgressStage;
  percent: number;
  message: string;
};

export type PrepareAtlasImportPhotoOptions = {
  analysis?: AnalyzedImportPhoto;
  onProgress?: (progress: AtlasImportPhotoProgress) => void;
};

export type PreparedImportPhotoObjectUrls = {
  masterUrl: string;
  thumbnailUrl: string;
  revoke: () => void;
};

export type AtlasImportPhotoErrorCode =
  | 'decode-failed'
  | 'encode-failed'
  | 'file-too-large'
  | 'image-too-large'
  | 'unsupported-browser'
  | 'unsupported-format';

export class AtlasImportPhotoError extends Error {
  constructor(
    readonly code: AtlasImportPhotoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AtlasImportPhotoError';
  }
}

type RawExifMetadata = {
  Orientation?: unknown;
  ImageWidth?: unknown;
  ImageHeight?: unknown;
  ExifImageWidth?: unknown;
  ExifImageHeight?: unknown;
  DateTimeOriginal?: unknown;
  DateTimeDigitized?: unknown;
  OffsetTimeOriginal?: unknown;
  OffsetTimeDigitized?: unknown;
  SubSecTimeOriginal?: unknown;
  SubSecTimeDigitized?: unknown;
  GPSLatitude?: unknown;
  GPSLatitudeRef?: unknown;
  GPSLongitude?: unknown;
  GPSLongitudeRef?: unknown;
  GPSAltitude?: unknown;
  GPSAltitudeRef?: unknown;
  GPSHPositioningError?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type LoadedPhoto = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const DECLARED_FORMATS: Record<string, AtlasImportPhotoFormat> = {
  'image/heic': 'heic',
  'image/heic-sequence': 'heic',
  'image/heif': 'heic',
  'image/heif-sequence': 'heic',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXIF_OPTIONS = {
  ifd0: { pick: ['Orientation', 'ImageWidth', 'ImageHeight'] },
  exif: {
    pick: [
      'DateTimeOriginal',
      'DateTimeDigitized',
      'OffsetTimeOriginal',
      'OffsetTimeDigitized',
      'SubSecTimeOriginal',
      'SubSecTimeDigitized',
      'ExifImageWidth',
      'ExifImageHeight',
    ],
  },
  gps: {
    pick: [
      'GPSLatitude',
      'GPSLatitudeRef',
      'GPSLongitude',
      'GPSLongitudeRef',
      'GPSAltitude',
      'GPSAltitudeRef',
      'GPSHPositioningError',
    ],
  },
  ifd1: false,
  interop: false,
  xmp: false,
  icc: false,
  iptc: false,
  jfif: false,
  ihdr: false,
  makerNote: false,
  userComment: false,
  reviveValues: false,
  translateKeys: true,
  translateValues: false,
  sanitize: true,
  mergeOutput: true,
  firstChunkSize: 64 * 1024,
  chunkSize: 64 * 1024,
  chunkLimit: 8,
};

let heicConversionTail: Promise<void> = Promise.resolve();
let heicWorker: Worker | null = null;
let heicWorkerIdleTimer: number | null = null;
let heicRequestSequence = 0;

function asFiniteNumber(value: unknown) {
  const candidate = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : null;
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  let value = '';
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function detectFormat(bytes: Uint8Array): AtlasImportPhotoFormat {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'webp';
  }
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brands = [ascii(bytes, 8, 4)];
    const declaredBoxSize =
      bytes.length >= 4 ? new DataView(bytes.buffer).getUint32(0) : 0;
    const boxEnd = Math.min(
      bytes.length,
      declaredBoxSize >= 16 ? declaredBoxSize : bytes.length,
    );
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
      brands.push(ascii(bytes, offset, 4));
    }
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'unknown';
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return 'heic';
  }

  return 'unknown';
}

async function hashSource(bytes: Uint8Array) {
  if (!globalThis.crypto?.subtle) {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'This browser cannot securely identify selected photographs.',
    );
  }
  // Copy into an ArrayBuffer-backed view. TypeScript's generic Uint8Array can
  // otherwise carry SharedArrayBuffer in its type even though our parser
  // always supplies ordinary file bytes.
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

type IntrinsicDimensions = { width: number; height: number };

function validIntrinsicDimensions(
  width: number,
  height: number,
): IntrinsicDimensions | null {
  return Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

function jpegIntrinsicDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    if (marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return validIntrinsicDimensions(
        view.getUint16(offset + 5),
        view.getUint16(offset + 3),
      );
    }
    offset += segmentLength;
  }
  return null;
}

function pngIntrinsicDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return validIntrinsicDimensions(view.getUint32(16), view.getUint32(20));
}

function webpIntrinsicDimensions(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') {
    const width = 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65_536;
    const height = 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65_536;
    return validIntrinsicDimensions(width, height);
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return validIntrinsicDimensions(
      (bits & 0x3fff) + 1,
      ((bits >>> 14) & 0x3fff) + 1,
    );
  }
  if (
    chunk === 'VP8 ' &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return validIntrinsicDimensions(
      view.getUint16(26, true) & 0x3fff,
      view.getUint16(28, true) & 0x3fff,
    );
  }
  return null;
}

function heicIntrinsicDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let largest: IntrinsicDimensions | null = null;

  const META_BOX = 0x6d657461;
  const ITEM_PROPERTIES_BOX = 0x69707270;
  const PROPERTY_CONTAINER_BOX = 0x6970636f;
  const SPATIAL_EXTENTS_BOX = 0x69737065;
  const containers = new Set([
    META_BOX,
    ITEM_PROPERTIES_BOX,
    PROPERTY_CONTAINER_BOX,
  ]);

  // HEIF stores coded item dimensions in `meta` -> `iprp` -> `ipco` ->
  // `ispe`. Walking declared boxes is both faster and safer than searching
  // every byte for the string "ispe". The worker and postdecode guard remain
  // the final boundary for composed HEIF grid images.
  const walkBoxes = (start: number, end: number, depth: number) => {
    if (depth > 4) return;
    let offset = start;
    while (offset + 8 <= end) {
      const shortSize = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      let headerSize = 8;
      let size = shortSize;
      if (shortSize === 1) {
        if (offset + 16 > end) return;
        headerSize = 16;
        size = Number(view.getBigUint64(offset + 8));
      } else if (shortSize === 0) {
        size = end - offset;
      }
      if (
        !Number.isSafeInteger(size) ||
        size < headerSize ||
        offset + size > end
      ) {
        return;
      }

      const contentStart = offset + headerSize;
      const boxEnd = offset + size;
      if (type === SPATIAL_EXTENTS_BOX && contentStart + 12 <= boxEnd) {
        const candidate = validIntrinsicDimensions(
          view.getUint32(contentStart + 4),
          view.getUint32(contentStart + 8),
        );
        if (
          candidate &&
          (!largest ||
            candidate.width * candidate.height > largest.width * largest.height)
        ) {
          largest = candidate;
        }
      } else if (containers.has(type)) {
        const childStart = contentStart + (type === META_BOX ? 4 : 0);
        if (childStart <= boxEnd) walkBoxes(childStart, boxEnd, depth + 1);
      }
      offset = boxEnd;
    }
  };

  walkBoxes(0, bytes.length, 0);
  return largest;
}

function intrinsicDimensions(
  format: AtlasImportPhotoFormat,
  bytes: Uint8Array,
) {
  if (format === 'jpeg') return jpegIntrinsicDimensions(bytes);
  if (format === 'png') return pngIntrinsicDimensions(bytes);
  if (format === 'webp') return webpIntrinsicDimensions(bytes);
  if (format === 'heic') return heicIntrinsicDimensions(bytes);
  return null;
}

function dmsToDecimal(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value);
  }
  if (!Array.isArray(value) || value.length < 3) return null;

  const degrees = asFiniteNumber(value[0]);
  const minutes = asFiniteNumber(value[1]);
  const seconds = asFiniteNumber(value[2]);
  if (
    degrees === null ||
    minutes === null ||
    seconds === null ||
    degrees < 0 ||
    minutes < 0 ||
    minutes >= 60 ||
    seconds < 0 ||
    seconds >= 60
  ) {
    return null;
  }

  return degrees + minutes / 60 + seconds / 3600;
}

function signedCoordinate(
  value: unknown,
  reference: unknown,
  positiveReference: 'N' | 'E',
  negativeReference: 'S' | 'W',
) {
  const decimal = dmsToDecimal(value);
  const normalizedReference =
    typeof reference === 'string' ? reference.trim().toUpperCase() : '';
  if (
    decimal === null ||
    (normalizedReference !== positiveReference &&
      normalizedReference !== negativeReference)
  ) {
    return null;
  }
  return normalizedReference === negativeReference ? -decimal : decimal;
}

function locationConfidence(accuracyMeters: number | null) {
  if (accuracyMeters === null) return 'medium' as const;
  if (accuracyMeters <= 25) return 'high' as const;
  if (accuracyMeters <= 100) return 'medium' as const;
  return 'low' as const;
}

function altitudeReference(value: unknown) {
  if (value instanceof Uint8Array) return value[0] ?? 0;
  return asFiniteNumber(value) ?? 0;
}

function extractLocation(metadata: RawExifMetadata): {
  location: AtlasImportPhotoLocation | null;
  issue: AtlasImportPhotoIssue | null;
} {
  const latitude = signedCoordinate(
    metadata.GPSLatitude,
    metadata.GPSLatitudeRef,
    'N',
    'S',
  );
  const longitude = signedCoordinate(
    metadata.GPSLongitude,
    metadata.GPSLongitudeRef,
    'E',
    'W',
  );

  if (latitude === null && longitude === null) {
    return {
      location: null,
      issue: {
        code: 'missing-location',
        severity: 'info',
        message: 'No location was embedded in this photograph.',
      },
    };
  }
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {
      location: null,
      issue: {
        code: 'invalid-location',
        severity: 'warning',
        message: 'The photograph contains incomplete or invalid GPS data.',
      },
    };
  }
  if (Math.abs(latitude) < 1e-8 && Math.abs(longitude) < 1e-8) {
    return {
      location: null,
      issue: {
        code: 'zero-zero-location',
        severity: 'warning',
        message: 'The photograph contains a placeholder location at 0°, 0°.',
      },
    };
  }

  const rawAccuracy = asFiniteNumber(metadata.GPSHPositioningError);
  const accuracyMeters =
    rawAccuracy !== null && rawAccuracy >= 0 ? rawAccuracy : null;
  const rawAltitude = asFiniteNumber(metadata.GPSAltitude);
  const altitudeMeters =
    rawAltitude === null
      ? null
      : Math.abs(rawAltitude) *
        (altitudeReference(metadata.GPSAltitudeRef) === 1 ? -1 : 1);

  return {
    location: {
      latitude,
      longitude,
      accuracyMeters,
      altitudeMeters,
      source: 'exif-gps',
      confidence: locationConfidence(accuracyMeters),
    },
    issue: null,
  };
}

function validDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeSubseconds(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return '000';
  const digits = String(value).replace(/\D/g, '');
  return (digits || '000').slice(0, 3).padEnd(3, '0');
}

function parseExifDateTime(
  value: unknown,
  offsetValue: unknown,
  subsecondValue: unknown,
) {
  if (typeof value !== 'string') return null;
  const match = value
    .trim()
    .match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    !validDateParts(year, month, day) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const localDate = `${yearText}-${monthText}-${dayText}`;
  const milliseconds = normalizeSubseconds(subsecondValue);
  const localDateTime = `${localDate}T${hourText}:${minuteText}:${secondText}.${milliseconds}`;
  const offset =
    typeof offsetValue === 'string' &&
    /^(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/.test(offsetValue.trim())
      ? offsetValue.trim()
      : null;
  const timestamp = offset ? Date.parse(`${localDateTime}${offset}`) : NaN;

  return {
    localDate,
    localDateTime,
    offset,
    instant: Number.isFinite(timestamp)
      ? new Date(timestamp).toISOString()
      : null,
  };
}

function dateFromFileTimestamp(file: File): AtlasImportPhotoCapture | null {
  if (!Number.isFinite(file.lastModified) || file.lastModified <= 0)
    return null;
  const date = new Date(file.lastModified);
  if (Number.isNaN(date.getTime())) return null;

  const localDate = [
    date.getFullYear().toString().padStart(4, '0'),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ].join('-');
  return {
    localDate,
    localDateTime: null,
    offset: null,
    instant: null,
    source: 'file-last-modified',
    confidence: 'low',
  };
}

function extractCapture(metadata: RawExifMetadata, file: File) {
  const original = parseExifDateTime(
    metadata.DateTimeOriginal,
    metadata.OffsetTimeOriginal,
    metadata.SubSecTimeOriginal,
  );
  if (original) {
    return {
      ...original,
      source: 'date-time-original',
      confidence: 'high',
    } satisfies AtlasImportPhotoCapture;
  }

  const digitized = parseExifDateTime(
    metadata.DateTimeDigitized,
    metadata.OffsetTimeDigitized,
    metadata.SubSecTimeDigitized,
  );
  if (digitized) {
    return {
      ...digitized,
      source: 'date-time-digitized',
      confidence: 'medium',
    } satisfies AtlasImportPhotoCapture;
  }

  // GPSDateStamp/GPSTimeStamp are UTC. They cannot safely become the local
  // calendar date shown in a memory without a trustworthy historical
  // timezone, so fall back to an explicitly low-confidence file date instead.
  return dateFromFileTimestamp(file);
}

function metadataPixelCount(metadata: RawExifMetadata) {
  const width = asFiniteNumber(metadata.ExifImageWidth ?? metadata.ImageWidth);
  const height = asFiniteNumber(
    metadata.ExifImageHeight ?? metadata.ImageHeight,
  );
  if (
    width === null ||
    height === null ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return width * height;
}

function orientationValue(value: unknown) {
  const orientation = asFiniteNumber(value);
  return orientation !== null && orientation >= 1 && orientation <= 8
    ? Math.trunc(orientation)
    : null;
}

function declaredFormat(file: File) {
  return DECLARED_FORMATS[file.type.trim().toLowerCase()] ?? 'unknown';
}

export async function analyzeAtlasImportPhoto(
  file: File,
): Promise<AnalyzedImportPhoto> {
  const oversized = file.size > IMPORT_SOURCE_MAX_BYTES;
  const [sourceBytes, metadataResult] = await Promise.all([
    oversized
      ? Promise.resolve<Uint8Array | null>(null)
      : file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
    oversized
      ? Promise.resolve(undefined)
      : import('exifr')
          .then(
            ({ parse }) =>
              parse(file, EXIF_OPTIONS) as Promise<RawExifMetadata | undefined>,
          )
          .catch(() => undefined),
  ]);
  const format = sourceBytes ? detectFormat(sourceBytes) : 'unknown';
  const sourceHash = sourceBytes ? await hashSource(sourceBytes) : null;
  const metadata = metadataResult ?? {};
  const issues: AtlasImportPhotoIssue[] = [];
  const locationResult = extractLocation(metadata);
  if (locationResult.issue) issues.push(locationResult.issue);

  const capture = extractCapture(metadata, file);
  if (!capture) {
    issues.push({
      code: 'missing-capture-date',
      severity: 'info',
      message: 'No reliable capture date was found in this photograph.',
    });
  }

  if (!metadataResult) {
    issues.push({
      code: 'metadata-unreadable',
      severity: 'info',
      message: 'This photograph did not include readable metadata.',
    });
  }
  if (oversized) {
    issues.push({
      code: 'file-too-large',
      severity: 'error',
      message: 'Choose a photograph smaller than 25 MB.',
    });
  }
  const headerDimensions = sourceBytes
    ? intrinsicDimensions(format, sourceBytes)
    : null;
  const declaredPixels = Math.max(
    metadataPixelCount(metadata) ?? 0,
    headerDimensions ? headerDimensions.width * headerDimensions.height : 0,
  );
  if (declaredPixels !== null && declaredPixels > IMPORT_MAX_PIXELS) {
    issues.push({
      code: 'image-too-large',
      severity: 'error',
      message: 'Choose a photograph no larger than 25 megapixels.',
    });
  }
  if (format === 'unknown') {
    issues.push({
      code: 'unsupported-format',
      severity: 'error',
      message: 'Choose a HEIC, JPG, PNG, or WebP photograph.',
    });
  }

  const claimedFormat = declaredFormat(file);
  if (
    format !== 'unknown' &&
    claimedFormat !== 'unknown' &&
    claimedFormat !== format
  ) {
    issues.push({
      code: 'mime-mismatch',
      severity: 'warning',
      message: 'The photograph type did not match its file contents.',
    });
  }

  return {
    file,
    name: file.name,
    byteSize: file.size,
    sourceHash,
    declaredMimeType: file.type.trim() || null,
    format,
    isHeic: format === 'heic',
    canPrepare: !issues.some((issue) => issue.severity === 'error'),
    orientation: orientationValue(metadata.Orientation),
    location: locationResult.location,
    capture,
    issues,
  };
}

function reportProgress(
  onProgress: PrepareAtlasImportPhotoOptions['onProgress'],
  progress: AtlasImportPhotoProgress,
) {
  onProgress?.(progress);
}

function enqueueHeicConversion<T>(operation: () => Promise<T>) {
  const result = heicConversionTail.then(operation, operation);
  heicConversionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function resetHeicWorker(worker: Worker) {
  if (heicWorker !== worker) return;
  if (heicWorkerIdleTimer !== null) {
    window.clearTimeout(heicWorkerIdleTimer);
    heicWorkerIdleTimer = null;
  }
  worker.terminate();
  heicWorker = null;
}

function getHeicWorker() {
  if (heicWorker) {
    if (heicWorkerIdleTimer !== null) {
      window.clearTimeout(heicWorkerIdleTimer);
      heicWorkerIdleTimer = null;
    }
    return heicWorker;
  }
  if (typeof Worker === 'undefined') {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'This browser cannot prepare HEIC photographs.',
    );
  }

  heicWorker = new Worker(
    new URL('./photo-import-heic.worker.ts', import.meta.url),
    {
      name: HEIC_WORKER_NAME,
      type: 'module',
    },
  );
  return heicWorker;
}

function scheduleHeicWorkerIdleReset(worker: Worker) {
  if (heicWorker !== worker) return;
  if (heicWorkerIdleTimer !== null) {
    window.clearTimeout(heicWorkerIdleTimer);
  }
  heicWorkerIdleTimer = window.setTimeout(() => {
    heicWorkerIdleTimer = null;
    resetHeicWorker(worker);
  }, HEIC_WORKER_IDLE_TIMEOUT_MS);
}

function nextHeicRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  heicRequestSequence += 1;
  return `${Date.now().toString(36)}-${heicRequestSequence.toString(36)}`;
}

function isTransferredBitmap(value: unknown): value is ImageBitmap {
  if (!value || typeof value !== 'object') return false;
  const bitmap = value as Partial<ImageBitmap>;
  return (
    Number.isInteger(bitmap.width) &&
    Number.isInteger(bitmap.height) &&
    (bitmap.width ?? 0) > 0 &&
    (bitmap.height ?? 0) > 0 &&
    typeof bitmap.close === 'function'
  );
}

function convertHeicInWorker(file: File) {
  const worker = getHeicWorker();
  const id = nextHeicRequestId();

  return new Promise<ImageBitmap>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleWorkerFailure);
      worker.removeEventListener('messageerror', handleWorkerFailure);
    };
    const fail = (message: string) => {
      cleanup();
      resetHeicWorker(worker);
      reject(new Error(message));
    };
    const handleMessage = (event: MessageEvent<unknown>) => {
      const response = event.data as Partial<AtlasHeicWorkerResponse> | null;
      if (!response || response.id !== id) return;
      if (
        response.kind !== 'converted' ||
        !('bitmap' in response) ||
        !isTransferredBitmap(response.bitmap)
      ) {
        fail('The HEIC decoder could not open this photograph.');
        return;
      }
      cleanup();
      scheduleHeicWorkerIdleReset(worker);
      resolve(response.bitmap);
    };
    const handleWorkerFailure = () => {
      fail('The HEIC decoder stopped unexpectedly.');
    };
    const timeout = window.setTimeout(() => {
      fail('The HEIC decoder took too long to respond.');
    }, HEIC_WORKER_TIMEOUT_MS);

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleWorkerFailure);
    worker.addEventListener('messageerror', handleWorkerFailure);

    const request: AtlasHeicWorkerRequest = { kind: 'convert', id, file };
    try {
      // Blob/File values are structured-cloneable. Keeping the source as a
      // Blob avoids allocating and detaching another full-size ArrayBuffer.
      worker.postMessage(request);
    } catch {
      fail('The HEIC decoder could not receive this photograph.');
    }
  });
}

async function normalizeHeic(file: File) {
  // Constructing the worker is intentionally lazy, and conversions are
  // serialized to cap libheif memory use during large selections.
  return enqueueHeicConversion(() => convertHeicInWorker(file));
}

async function createBitmap(blob: Blob) {
  if (typeof window.createImageBitmap !== 'function') return null;
  try {
    return await window.createImageBitmap(blob, {
      imageOrientation: 'from-image',
    });
  } catch {
    try {
      return await window.createImageBitmap(blob);
    } catch {
      // Safari can render formats through HTMLImageElement that its
      // createImageBitmap implementation does not accept.
      return null;
    }
  }
}

async function loadPhoto(blob: Blob): Promise<LoadedPhoto> {
  const bitmap = await createBitmap(blob);
  if (bitmap) {
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  if (
    typeof document === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'This browser cannot prepare photographs for import.',
    );
  }
  const objectUrl = URL.createObjectURL(blob);
  const image = new window.Image();
  image.decoding = 'async';
  let removeLoadListeners = () => undefined;
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      removeLoadListeners();
      reject(new Error('The browser took too long to load this photograph.'));
    }, IMAGE_LOAD_TIMEOUT_MS);
    const handleLoad = () => {
      removeLoadListeners();
      resolve();
    };
    const handleError = () => {
      removeLoadListeners();
      reject(new Error('The browser could not load this photograph.'));
    };
    removeLoadListeners = () => {
      window.clearTimeout(timeout);
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };
    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });
  image.src = objectUrl;
  try {
    // Chrome on iOS can render a camera-roll HEIC through WebKit even when
    // HTMLImageElement.decode() rejects. Treat the real load event as equally
    // authoritative and use decode() only as an eager optimization.
    const decoded =
      typeof image.decode === 'function'
        ? image.decode().catch(() => loaded)
        : loaded;
    await Promise.race([loaded, decoded]);
    removeLoadListeners();
    if (image.naturalWidth < 1 || image.naturalHeight < 1) {
      throw new Error('The photograph did not expose valid dimensions.');
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    removeLoadListeners();
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadHeicPhoto(file: File): Promise<LoadedPhoto> {
  // Safari 17+ decodes HEIC natively. Prefer that path on iPhone and iPad so a
  // camera-roll preview does not need to initialize the large WASM decoder.
  // Chromium and older browsers fall through to the isolated worker.
  try {
    return await loadPhoto(file);
  } catch {
    const bitmap = await normalizeHeic(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }
}

function constrainedDimensions(width: number, height: number, maximum: number) {
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== type) {
          reject(
            new AtlasImportPhotoError(
              'encode-failed',
              'This browser could not prepare the photograph.',
            ),
          );
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function renderDerivative(
  photo: LoadedPhoto,
  dimensions: { width: number; height: number },
  type: string,
  quality: number,
  maximumBytes: number,
) {
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'This browser cannot prepare photographs for import.',
    );
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
  try {
    const qualities = [quality, Math.max(0.68, quality - 0.1), 0.62];
    for (const candidate of qualities) {
      const blob = await canvasToBlob(canvas, type, candidate);
      if (blob.size <= maximumBytes) return blob;
    }
    throw new AtlasImportPhotoError(
      'encode-failed',
      'This photograph could not be reduced to a safe upload size.',
    );
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function prepareAtlasImportPhoto(
  file: File,
  options: PrepareAtlasImportPhotoOptions = {},
): Promise<PreparedImportPhoto> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'Photographs can only be prepared in a browser.',
    );
  }

  reportProgress(options.onProgress, {
    stage: 'analyzing',
    percent: 5,
    message: 'Reading photograph details…',
  });
  const analysis = options.analysis ?? (await analyzeAtlasImportPhoto(file));
  if (!analysis.canPrepare) {
    const code = analysis.issues.some(
      (issue) => issue.code === 'file-too-large',
    )
      ? 'file-too-large'
      : 'unsupported-format';
    throw new AtlasImportPhotoError(
      code,
      analysis.issues.find((issue) => issue.severity === 'error')?.message ??
        'This photograph cannot be prepared.',
    );
  }

  if (analysis.isHeic) {
    reportProgress(options.onProgress, {
      stage: 'converting-heic',
      percent: 15,
      message: 'Opening the HEIC photograph…',
    });
  }

  reportProgress(options.onProgress, {
    stage: 'decoding',
    percent: analysis.isHeic ? 55 : 20,
    message: 'Preparing the photograph…',
  });
  let photo: LoadedPhoto;
  try {
    photo = analysis.isHeic ? await loadHeicPhoto(file) : await loadPhoto(file);
  } catch (error) {
    if (error instanceof AtlasImportPhotoError) throw error;
    console.error('Atlas photograph decode failed:', error);
    throw new AtlasImportPhotoError(
      'decode-failed',
      'This photograph could not be opened.',
    );
  }

  try {
    if (
      !Number.isInteger(photo.width) ||
      !Number.isInteger(photo.height) ||
      photo.width < 1 ||
      photo.height < 1 ||
      photo.width > IMPORT_MAX_DIMENSION ||
      photo.height > IMPORT_MAX_DIMENSION ||
      photo.width * photo.height > IMPORT_MAX_PIXELS
    ) {
      throw new AtlasImportPhotoError(
        'image-too-large',
        'Choose a photograph no larger than 25 megapixels.',
      );
    }

    const masterDimensions = constrainedDimensions(
      photo.width,
      photo.height,
      IMPORT_MASTER_MAX_DIMENSION,
    );
    const thumbnailDimensions = constrainedDimensions(
      photo.width,
      photo.height,
      IMPORT_THUMBNAIL_MAX_DIMENSION,
    );
    reportProgress(options.onProgress, {
      stage: 'rendering',
      percent: 70,
      message: 'Creating private, metadata-free copies…',
    });
    const [master, thumbnail] = await Promise.all([
      renderDerivative(
        photo,
        masterDimensions,
        IMPORT_MASTER_MIME_TYPE,
        IMPORT_MASTER_QUALITY,
        ATLAS_MEDIA_MAX_BYTES,
      ),
      renderDerivative(
        photo,
        thumbnailDimensions,
        IMPORT_THUMBNAIL_MIME_TYPE,
        IMPORT_THUMBNAIL_QUALITY,
        ATLAS_THUMBNAIL_MAX_BYTES,
      ),
    ]);

    const prepared = {
      analysis,
      master,
      thumbnail,
      dimensions: {
        sourceWidth: photo.width,
        sourceHeight: photo.height,
        masterWidth: masterDimensions.width,
        masterHeight: masterDimensions.height,
        thumbnailWidth: thumbnailDimensions.width,
        thumbnailHeight: thumbnailDimensions.height,
      },
    } satisfies PreparedImportPhoto;
    reportProgress(options.onProgress, {
      stage: 'ready',
      percent: 100,
      message: 'Ready to become a memory.',
    });
    return prepared;
  } finally {
    photo.release();
  }
}

/**
 * Creates the only image retained by the bulk-import review UI. The source is
 * decoded one item at a time by the caller, painted through a canvas to strip
 * metadata, and bounded to the same 1024px policy as stored thumbnails. It
 * intentionally does not create or retain the larger upload derivative.
 */
export async function prepareAtlasImportPreview(
  file: File,
  analysis: AnalyzedImportPhoto,
): Promise<PreparedAtlasImportPreview> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'Photographs can only be previewed in a browser.',
    );
  }
  if (!analysis.canPrepare) {
    throw new AtlasImportPhotoError(
      'unsupported-format',
      analysis.issues.find((issue) => issue.severity === 'error')?.message ??
        'This photograph cannot be previewed.',
    );
  }

  let photo: LoadedPhoto;
  try {
    photo = analysis.isHeic ? await loadHeicPhoto(file) : await loadPhoto(file);
  } catch (error) {
    if (error instanceof AtlasImportPhotoError) throw error;
    console.error('Atlas photograph preview decode failed:', error);
    throw new AtlasImportPhotoError(
      'decode-failed',
      'This photograph could not be previewed.',
    );
  }

  try {
    if (
      !Number.isInteger(photo.width) ||
      !Number.isInteger(photo.height) ||
      photo.width < 1 ||
      photo.height < 1 ||
      photo.width > IMPORT_MAX_DIMENSION ||
      photo.height > IMPORT_MAX_DIMENSION ||
      photo.width * photo.height > IMPORT_MAX_PIXELS
    ) {
      throw new AtlasImportPhotoError(
        'image-too-large',
        'Choose a photograph no larger than 25 megapixels.',
      );
    }
    const dimensions = constrainedDimensions(
      photo.width,
      photo.height,
      IMPORT_THUMBNAIL_MAX_DIMENSION,
    );
    const blob = await renderDerivative(
      photo,
      dimensions,
      IMPORT_THUMBNAIL_MIME_TYPE,
      IMPORT_THUMBNAIL_QUALITY,
      ATLAS_THUMBNAIL_MAX_BYTES,
    );
    return { blob, width: dimensions.width, height: dimensions.height };
  } finally {
    photo.release();
  }
}

export function createPreparedImportPhotoObjectUrls(
  photo: Pick<PreparedImportPhoto, 'master' | 'thumbnail'>,
): PreparedImportPhotoObjectUrls {
  if (typeof URL.createObjectURL !== 'function') {
    throw new AtlasImportPhotoError(
      'unsupported-browser',
      'This browser cannot preview prepared photographs.',
    );
  }
  const masterUrl = URL.createObjectURL(photo.master);
  const thumbnailUrl = URL.createObjectURL(photo.thumbnail);
  let revoked = false;

  return {
    masterUrl,
    thumbnailUrl,
    revoke: () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(masterUrl);
      URL.revokeObjectURL(thumbnailUrl);
    },
  };
}

export const ATLAS_IMPORT_PHOTO_LIMITS = {
  sourceMaxBytes: IMPORT_SOURCE_MAX_BYTES,
  sourceMaxPixels: IMPORT_MAX_PIXELS,
  masterMaxDimension: IMPORT_MASTER_MAX_DIMENSION,
  masterMaxBytes: ATLAS_MEDIA_MAX_BYTES,
  thumbnailMaxDimension: IMPORT_THUMBNAIL_MAX_DIMENSION,
  thumbnailMaxBytes: ATLAS_THUMBNAIL_MAX_BYTES,
  masterMimeType: IMPORT_MASTER_MIME_TYPE,
  thumbnailMimeType: IMPORT_THUMBNAIL_MIME_TYPE,
} as const;
